import express from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import https from 'https';

// ── Credenciales ────────────────────────────────────────────────────────────────
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_1243052028017945';
const API_VERSION = 'v20.0';
const PORT = process.env.PORT || 3000;

if (!ACCESS_TOKEN) {
  console.error('ERROR: META_ACCESS_TOKEN no está definido.');
  process.exit(1);
}

// ── Utilidades ──────────────────────────────────────────────────────────────────
function fetchMeta(path, params = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ ...params, access_token: ACCESS_TOKEN });
    const url = `https://graph.facebook.com/${API_VERSION}${path}?${query}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Parse error: ' + body.slice(0, 300))); }
      });
    }).on('error', reject);
  });
}

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const extractAction = (actions, type) =>
  (Array.isArray(actions) ? actions.find((a) => a.action_type === type)?.value : null) ?? '0';
const extractCPA = (cpa, type) =>
  (Array.isArray(cpa) ? cpa.find((a) => a.action_type === type)?.value : null) ?? 'N/A';

// ── Servidor MCP ────────────────────────────────────────────────────────────────
function buildMcpServer() {
  const server = new McpServer({ name: 'rema-meta-ads', version: '1.0.0' });

  // ── get_campaigns ──────────────────────────────────────────────────────────────
  server.tool(
    'get_campaigns',
    'Lista las campañas de REMA en Meta Ads filtradas por estado.',
    { status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).default('ACTIVE') },
    async ({ status }) => {
      const data = await fetchMeta(`/${AD_ACCOUNT_ID}/campaigns`, {
        effective_status: JSON.stringify([status]),
        fields: 'id,name,status,objective,start_time,stop_time,daily_budget,lifetime_budget',
        limit: 50,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── get_all_campaigns_insights ─────────────────────────────────────────────────
  server.tool(
    'get_all_campaigns_insights',
    'Métricas de TODAS las campañas activas de REMA: leads, CPL, gasto, impresiones, CTR.',
    {
      since: z.string().optional().describe('Fecha inicio YYYY-MM-DD. Default: inicio del mes.'),
      until: z.string().optional().describe('Fecha fin YYYY-MM-DD. Default: hoy.'),
    },
    async ({ since, until }) => {
      const s = since || firstOfMonth();
      const u = until || today();
      const data = await fetchMeta(`/${AD_ACCOUNT_ID}/insights`, {
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type',
        level: 'campaign',
        time_range: JSON.stringify({ since: s, until: u }),
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
        cpl: extractCPA(c.cost_per_action_type, 'lead'),
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ data: processed, period: { since: s, until: u } }, null, 2) }] };
    }
  );

  // ── get_campaign_insights ──────────────────────────────────────────────────────
  server.tool(
    'get_campaign_insights',
    'Métricas detalladas de una campaña específica de REMA: leads, CPL, gasto, CTR, alcance, frecuencia.',
    {
      campaign_id: z.string().describe('ID numérico de la campaña'),
      since: z.string().optional().describe('Fecha inicio YYYY-MM-DD.'),
      until: z.string().optional().describe('Fecha fin YYYY-MM-DD.'),
    },
    async ({ campaign_id, since, until }) => {
      const s = since || firstOfMonth();
      const u = until || today();
      const data = await fetchMeta(`/${campaign_id}/insights`, {
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type',
        time_range: JSON.stringify({ since: s, until: u }),
      });
      const raw = (data.data || [])[0] || {};
      const result = {
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
        cpl: extractCPA(raw.cost_per_action_type, 'lead'),
        period: { since: s, until: u },
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── get_adsets ─────────────────────────────────────────────────────────────────
  server.tool(
    'get_adsets',
    'Lista los conjuntos de anuncios (ad sets) de una campaña de REMA.',
    { campaign_id: z.string().describe('ID numérico de la campaña') },
    async ({ campaign_id }) => {
      const data = await fetchMeta(`/${campaign_id}/adsets`, {
        fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,start_time,end_time',
        limit: 50,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── get_ads ────────────────────────────────────────────────────────────────────
  server.tool(
    'get_ads',
    'Lista los anuncios individuales de una campaña o ad set de REMA.',
    {
      campaign_id: z.string().optional().describe('ID de la campaña'),
      adset_id: z.string().optional().describe('ID del ad set'),
    },
    async ({ campaign_id, adset_id }) => {
      const endpoint = adset_id ? `/${adset_id}/ads` : campaign_id ? `/${campaign_id}/ads` : null;
      if (!endpoint) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Se requiere campaign_id o adset_id' }) }] };
      const data = await fetchMeta(endpoint, {
        fields: 'id,name,status,creative{id,name,title,body,image_url}',
        limit: 50,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── get_ads_insights ───────────────────────────────────────────────────────────
  server.tool(
    'get_ads_insights',
    'Métricas por anuncio individual de REMA: leads, CPL, CTR, hook rate. Identifica el creativo ganador.',
    {
      campaign_id: z.string().describe('ID numérico de la campaña'),
      since: z.string().optional().describe('Fecha inicio YYYY-MM-DD.'),
      until: z.string().optional().describe('Fecha fin YYYY-MM-DD.'),
    },
    async ({ campaign_id, since, until }) => {
      const s = since || firstOfMonth();
      const u = until || today();
      const data = await fetchMeta(`/${campaign_id}/insights`, {
        fields: 'ad_id,ad_name,spend,impressions,clicks,ctr,cpc,reach,actions,cost_per_action_type',
        level: 'ad',
        time_range: JSON.stringify({ since: s, until: u }),
        limit: 50,
      });
      const processed = (data.data || []).map((ad) => {
        const videoViews = parseInt(extractAction(ad.actions, 'video_view') || '0');
        const imp = parseInt(ad.impressions || '0');
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
          cpl: extractCPA(ad.cost_per_action_type, 'lead'),
          hook_rate: imp > 0 ? ((videoViews / imp) * 100).toFixed(2) + '%' : 'N/A',
        };
      });
      return { content: [{ type: 'text', text: JSON.stringify({ data: processed, period: { since: s, until: u } }, null, 2) }] };
    }
  );

  return server;
}

// ── Express ─────────────────────────────────────────────────────────────────────
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok', server: 'rema-meta-ads MCP', version: '1.0.0' });
});

// ── Streamable HTTP (protocolo actual de Claude.ai) ────────────────────────────
const sessions = new Map();

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];

    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = buildMcpServer();
    await server.connect(transport);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, server });
      transport.onclose = () => sessions.delete(transport.sessionId);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('Error en /mcp POST:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(400).json({ error: 'Sesión no encontrada' });
    }
    await sessions.get(sessionId).transport.handleRequest(req, res);
  } catch (err) {
    console.error('Error en /mcp GET:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.delete('/mcp', (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId) sessions.delete(sessionId);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`REMA Meta Ads MCP — puerto ${PORT}`);
  console.log(`Endpoint: https://msprema.onrender.com/mcp`);
  console.log(`Cuenta: ${AD_ACCOUNT_ID}`);
});
