import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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

function today() {
  return new Date().toISOString().slice(0, 10);
}
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
        status: {
          type: 'string',
          enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'],
          description: 'Estado de las campañas. Default: ACTIVE',
        },
      },
    },
  },
  {
    name: 'get_all_campaigns_insights',
    description: 'Métricas resumidas de TODAS las campañas activas de REMA: leads generados, CPL, gasto, impresiones y CTR en un rango de fechas.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Fecha inicio YYYY-MM-DD. Default: primer día del mes actual.' },
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
        since: { type: 'string', description: 'Fecha inicio YYYY-MM-DD. Default: primer día del mes actual.' },
        until: { type: 'string', description: 'Fecha fin YYYY-MM-DD. Default: hoy.' },
      },
    },
  },
  {
    name: 'get_adsets',
    description: 'Lista los conjuntos de anuncios (ad sets) de una campaña de REMA con presupuesto y segmentación.',
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
        adset_id: { type: 'string', description: 'ID del ad set (alternativo a campaign_id)' },
      },
    },
  },
  {
    name: 'get_ads_insights',
    description: 'Métricas por anuncio individual de REMA: leads, CPL, CTR, hook rate. Permite identificar el creativo ganador.',
    inputSchema: {
      type: 'object',
      required: ['campaign_id'],
      properties: {
        campaign_id: { type: 'string', description: 'ID numérico de la campaña' },
        since: { type: 'string', description: 'Fecha inicio YYYY-MM-DD. Default: primer día del mes actual.' },
        until: { type: 'string', description: 'Fecha fin YYYY-MM-DD. Default: hoy.' },
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
      const endpoint = args.adset_id
        ? `/${args.adset_id}/ads`
        : args.campaign_id
          ? `/${args.campaign_id}/ads`
          : null;
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
        const hookRate = impressions > 0 ? ((videoViews / impressions) * 100).toFixed(2) + '%' : 'N/A';
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
          hook_rate: hookRate,
        };
      });
      return JSON.stringify({ data: processed, period: { since, until } }, null, 2);
    }

    default:
      return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
  }
}

// ── Servidor Express + SSE ──────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Mapa de sesiones SSE activas
const transports = new Map();

// Healthcheck para Render
app.get('/', (req, res) => {
  res.json({ status: 'ok', server: 'rema-meta-ads MCP', version: '1.0.0' });
});

// Endpoint SSE — Claude.ai se conecta aquí
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);

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

  transports.set(transport.sessionId, transport);
  res.on('close', () => {
    transports.delete(transport.sessionId);
    console.log(`Sesión ${transport.sessionId} cerrada.`);
  });

  console.log(`Nueva conexión SSE: ${transport.sessionId}`);
  await server.connect(transport);
});

// Endpoint de mensajes POST — Claude.ai envía mensajes aquí
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`REMA Meta Ads MCP Server corriendo en puerto ${PORT}`);
  console.log(`Cuenta publicitaria: ${AD_ACCOUNT_ID}`);
});
