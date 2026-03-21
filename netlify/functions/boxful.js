const https = require("https");
const http = require("http");

exports.handler = async function (event) {
  const shipment = event.queryStringParameters?.shipment;
  if (!shipment) {
    return { statusCode: 400, body: JSON.stringify({ error: "Falta shipment" }) };
  }

  const url = `https://tracking.goboxful.com?shipment=${shipment}`;

  try {
    const html = await fetchUrl(url);
    const steps = parseTracking(html);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ steps }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseTracking(html) {
  const steps = [];

  // Patrones comunes en páginas de tracking de Box Full
  // Busca bloques con estado y fecha
  const patterns = [
    // Formato: título + fecha/estado en elementos de timeline
    /<[^>]*class="[^"]*(?:timeline|step|track|status)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi,
    // Busca elementos con palabras clave de estado
    /(?:Creado|Registrado|Recolectado|Ruta a destino|Entregado)[^<]*/gi,
  ];

  // Intentar extraer pasos de timeline estructurada
  const timelineRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = timelineRegex.exec(html)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<[^>]*>([^<]*(?:Creado|Registrado|Recolectado|Ruta|Entregado)[^<]*)<\/[^>]*>/i);
    const dateMatch = block.match(/(\d{1,2}\s+\w+\s+\d{4}[^<]*\d{1,2}:\d{2}[^<]*)/i);
    const completedMatch = /(?:completed|done|active|success|checked)/i.test(block);
    const pendingMatch = /(?:pending|inactive|disabled|gray)/i.test(block);

    if (titleMatch) {
      steps.push({
        title: titleMatch[1].trim(),
        date: dateMatch ? dateMatch[1].trim() : (completedMatch ? "Completado" : "Pendiente"),
        done: completedMatch && !pendingMatch,
      });
    }
  }

  // Si no encontró nada con li, buscar divs con clases de tracking
  if (steps.length === 0) {
    const divRegex = /<div[^>]*class="[^"]*(?:step|track|status|event)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    while ((match = divRegex.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/>([^<]+(?:Creado|Registrado|Recolectado|Ruta|Entregado)[^<]*)</i);
      if (titleMatch) {
        const dateMatch = block.match(/(\d{1,2}[^<]*\d{4}[^<]*\d{1,2}:\d{2})/);
        const done = !/>Pendiente</i.test(block);
        steps.push({
          title: titleMatch[1].trim(),
          date: dateMatch ? dateMatch[1].trim() : (done ? "Completado" : "Pendiente"),
          done,
        });
      }
    }
  }

  // Fallback: buscar texto plano con los estados conocidos
  if (steps.length === 0) {
    const stateNames = ["Creado", "Registrado", "Recolectado", "Ruta a destino", "Entregado"];
    stateNames.forEach((name) => {
      const regex = new RegExp(name + "[\\s\\S]{0,200}", "i");
      const m = html.match(regex);
      if (m) {
        const dateM = m[0].match(/(\d{1,2}\s+\w{3,}\s+\d{4}[^<\n]*)/);
        const isPending = /pendiente/i.test(m[0]);
        steps.push({
          title: name,
          date: dateM ? dateM[1].trim() : (isPending ? "Pendiente" : "Completado"),
          done: !isPending,
        });
      }
    });
  }

  return steps;
}
