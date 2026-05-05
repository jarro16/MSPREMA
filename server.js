import express from 'express';
import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import https from 'https';

// ── Credenciales ────────────────────────────────────────────────────────────────
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_1243052028017945';
const API_VERSION = 'v20.0';
const PORT = process.env.PORT || 3000;

if (!ACCESS_TOKEN) {
  console.error('ERROR: META_ACCESS_TOKEN no está definido como variable de entorno.');
  process.exit(1);
}

// ── Utilidad HTTP ───────────────────────────────────────────────────────────────
function fetchMeta(path, params = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ ...params, access_token: ACCESS_TOKEN });
    const url = `https://graph.facebook.com/${API_VERSION}${path}?${query}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Error al parsear respuesta de Meta: ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function today() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function extractAction(actions, type) {
  if (!Array.isArray(actions)) return '0';
  const found = actions.find((a) => a.action_type === type);
  return found ? found.value : '0';
}
function extractCostPerAction(cpa, type) {
  if (!Array.isArray(cpa)) return 'N/A';
  const found = cpa.find((a) => a.action_type === type);
  return found ? found.value : 'N/A';
}

// ── Definición de herramientas ──────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_campaigns',
    description: 'Lista las campañas de REMA en Meta Ads. Filtra por estado: ACTIVE, PAUSED o ARCHIVED.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'], description: 'Estado. Default: ACTIVE' },
      },
    },
  },
  {
    name: 'get_all_campaigns_insights',
    description: 'Métricas de TODAS las campañas activas de REMA: leads, CPL, gasto, impresiones y CTR.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Fecha inicio YYYY-MM-DD. Default: inicio del mes.' },
        until: { type: 'string', description: 'Fecha fin YYYY-MM-DD. Default: hoy.' },
      },
    },
  },
  {
    name: 'get_campaign_insights',
    description: 'Métricas detalladas de una campaña específica de REMA: leads, CPL, gasto, CTR, alcance y frecuencia.',
    inputSchema: {
      type: 'object',
      required: ['campaign_id'],
      properties: {
        campaign_id: { type: 'string', description: 'ID numérico de la campaña' },
        since: { type: 'string', description: 'Fecha inicio YYYY-MM-DD.' },
        until: { type: 'string', description: 'Fecha fin YYYY-MM-DD.' },
      },
    },
  },
  {
    name: 'get_adsets',
    description: 'Lista los ad sets de una campaña de REMA con presupuesto y segmentación.',
    inputSchema: {
      type: 'object',
      required: ['campaign_id'],
      properties: {
        campaign_id: { type: 'string', description: 'ID numérico de la campaña' },
      },
    },
  },
  {
    name: 'get_ads',
    description: 'Lista los anuncios individuales de una campaña o ad set de REMA.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'ID de la campaña' },
        adset_id: { type: 'string', description: 'ID del ad set' },
      },
    },
  },
  {
    name: 'get_ads_insights',
    description: 'Métricas por anuncio individual de REMA: leads, CPL, CTR, hook rate.',
    inputSchema: {
      type: 'object',
      required: ['campaign_id'],
      properties: {
        campaign_id: { type: 'string', description: 'ID numérico de la campaña' },
        since: { type: 'string', description: 'Fecha inicio YYYY-MM-DD.' },
        until: { type: 'string', description: 'Fecha fin YYYY-MM-DD.' },
      },
    },
  },
];

// ── Lógica de herramientas ──────────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {
    case 'get_campaigns': {
      const status = args.status || 'ACTIVE';
      const data = await fetchMeta(`/${AD_ACCOUNT_ID}/campaigns`, {
        effective_status: JSON.stringify([status]),
        fields: 'id,name,status,objective,start_time,stop_time,daily_budget,lifetime_budget',
        limit: 50,
      });
      return JSON.stringify(data, null, 2);
    }
    case 'get_all_campaigns_insights': {
      const since = args.since || firstOfMonth();
      const until = args.until || today();
      const data = await fetchMeta(`/${AD_ACCOUNT_ID}/insights`, {
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type',
        level: 'campaign',
        time_range: JSON.stringify({ since, until }),
        limit: 50,
      });
      const processed = (data.data || []).map((c) => ({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        spend: c.spend,
        impressions: c.impressions,
        clicks: c.clicks,
        ctr: c.ctr,
        cpc: c.cpc,
        reach: c.reach,
        frequency: c.frequency,
        leads: extractAction(c.actions, 'lead'),
        cpl: extractCostPerAction(c.cost_per_action_type, 'lead'),
      }));
      return JSON.stringify({ data: processed, period: { since, until } }, null, 2);
    }
    case 'get_campaign_insights': {
      const since = args.since || firstOfMonth();
      const until = args.until || today();
      const data = await fetchMeta(`/${args.campaign_id}/insights`, {
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type',
        time_range: JSON.stringify({ since, until }),
      });
      const raw = (data.data || [])[0] || {};
      return JSON.stringify({
        campaign_id: raw.campaign_id,
        campaign_name: raw.campaign_name,
        spend: raw.spend,
        impressions: raw.impressions,
        clicks: raw.clicks,
        ctr: raw.ctr,
        cpc: raw.cpc,
        reach: raw.reach,
        frequency: raw.frequency,
        leads: extractAction(raw.actions, 'lead'),
        cpl: extractCostPerAction(raw.cost_per_action_type, 'lead'),
        period: { since, until },
      }, null, 2);
    }
    case 'get_adsets': {
      const data = await fetchMeta(`/${args.campaign_id}/adsets`, {
        fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,start_time,end_time',
        limit: 50,
      });
      return JSON.stringify(data, null, 2);
    }
    case 'get_ads': {
      const endpoint = args.adset_id ? `/${args.adset_id}/ads`
        : args.campaign_id ? `/${args.campaign_id}/ads` : null;
      if (!endpoint) return JSON.stringify({ error: 'Se requiere campaign_id o adset_id' });
      const data = await fetchMeta(endpoint, {
        fields: 'id,name,status,creative{id,name,title,body,image_url}',
        limit: 50,
      });
      return JSON.stringify(data, null, 2);
    }
    case 'get_ads_insights': {
      const since = args.since || firstOfMonth();
      const until = args.until || today();
      const data = await fetchMeta(`/${args.campaign_id}/insights`, {
        fields: 'ad_id,ad_name,spend,impressions,clicks,ctr,cpc,reach,actions,cost_per_action_type',
        level: 'ad',
        time_range: JSON.stringify({ since, until }),
        limit: 50,
      });
      const processed = (data.data || []).map((ad) => {
        const videoViews = parseInt(extractAction(ad.actions, 'video_view') || '0');
        const impressions = parseInt(ad.impressions || '0');
        return {
          ad_id: ad.ad_id,
          ad_name: ad.ad_name,
          spend: ad.spend,
          impressions: ad.impressions,
          clicks: ad.clicks,
          ctr: ad.ctr,
          cpc: ad.cpc,
          reach: ad.reach,
          leads: extractAction(ad.actions, 'lead'),
          cpl: extractCostPerAction(ad.cost_per_action_type, 'lead'),
          hook_rate: impressions > 0 ? ((videoViews / impressions) * 100).toFixed(2) + '%' : 'N/A',
        };
      });
      return JSON.stringify({ data: processed, period: { since, until } }, null, 2);
    }
    default:
      return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
  }
}

// ── Factory de servidor MCP ─────────────────────────────────────────────────────
function buildMcpServer() {
  const server = new Server(
    { name: 'rema-meta-ads', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const text = await handleTool(request.params.name, request.params.arguments || {});
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
    }
  });
  return server;
}

// ── Express ─────────────────────────────────────────────────────────────────────
const app = express();

// CORS — requerido para conexiones desde Claude.ai
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// ── Healthcheck ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', server: 'rema-meta-ads MCP', version: '1.0.0', protocols: ['streamable-http', 'sse'] });
});

// ────────────────────────────────────────────────────────────────────────────────
// PROTOCOLO 1: Streamable HTTP (estándar actual — usar esta URL en Claude.ai)
// URL: https://msprema.onrender.com/mcp
// ────────────────────────────────────────────────────────────────────────────────
const httpSessions = new Map();

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];

  if (sessionId && httpSessions.has(sessionId)) {
    // Sesión existente
    const transport = httpSessions.get(sessionId);
    await transport.handleRequest(req, res, req.body);
  } else {
    // Nueva sesión
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    transport.onclose = () => {
      if (transport.sessionId) httpSessions.delete(transport.sessionId);
    };
    const server = buildMcpServer();
    await server.connect(transport);
    if (transport.sessionId) httpSessions.set(transport.sessionId, transport);
    await transport.handleRequest(req, res, req.body);
  }
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !httpSessions.has(sessionId)) {
    return res.status(400).json({ error: 'Sesión no válida' });
  }
  await httpSessions.get(sessionId).handleRequest(req, res);
});

app.delete('/mcp', (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId) httpSessions.delete(sessionId);
  res.sendStatus(200);
});

// ────────────────────────────────────────────────────────────────────────────────
// PROTOCOLO 2: SSE legacy (por compatibilidad)
// URL: https://msprema.onrender.com/sse
// ────────────────────────────────────────────────────────────────────────────────
const sseSessions = new Map();

app.get('/sse', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const transport = new SSEServerTransport('/messages', res);
  const server = buildMcpServer();
  sseSessions.set(transport.sessionId, transport);
  res.on('close', () => sseSessions.delete(transport.sessionId));
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseSessions.get(sessionId);
  if (!transport) return res.status(404).json({ error: 'Sesión no encontrada' });
  await transport.handlePostMessage(req, res);
});

// ────────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`REMA Meta Ads MCP Server — puerto ${PORT}`);
  console.log(`  Streamable HTTP : /mcp   ← usar en Claude.ai`);
  console.log(`  SSE legacy      : /sse`);
  console.log(`  Cuenta          : ${AD_ACCOUNT_ID}`);
});
