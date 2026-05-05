import express from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import https from 'https';

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_1243052028017945';
const API_VERSION = 'v20.0';
const PORT = process.env.PORT || 3000;

if (!ACCESS_TOKEN) { console.error('ERROR: META_ACCESS_TOKEN no definido.'); process.exit(1); }

function fetchMeta(path, params = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ ...params, access_token: ACCESS_TOKEN });
    https.get(`https://graph.facebook.com/${API_VERSION}${path}?${query}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(body.slice(0,200))); } });
    }).on('error', reject);
  });
}

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const getAction = (arr, type) => (Array.isArray(arr) ? arr.find(a => a.action_type === type)?.value : null) ?? '0';
const getCPA = (arr, type) => (Array.isArray(arr) ? arr.find(a => a.action_type === type)?.value : null) ?? 'N/A';

function buildMcpServer() {
  const server = new McpServer({ name: 'rema-meta-ads', version: '1.0.0' });

  server.tool('get_campaigns', 'Lista campañas de REMA (ACTIVE, PAUSED o ARCHIVED).',
    { status: z.enum(['ACTIVE','PAUSED','ARCHIVED']).default('ACTIVE') },
    async ({ status }) => {
      const d = await fetchMeta(`/${AD_ACCOUNT_ID}/campaigns`, {
        effective_status: JSON.stringify([status]),
        fields: 'id,name,status,objective,start_time,daily_budget,lifetime_budget', limit: 50 });
      return { content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] };
    });

  server.tool('get_all_campaigns_insights', 'Métricas de todas las campañas activas de REMA: leads, CPL, gasto, CTR.',
    { since: z.string().optional(), until: z.string().optional() },
    async ({ since, until }) => {
      const s = since || firstOfMonth(), u = until || today();
      const d = await fetchMeta(`/${AD_ACCOUNT_ID}/insights`, {
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type',
        level: 'campaign', time_range: JSON.stringify({ since: s, until: u }), limit: 50 });
      const out = (d.data||[]).map(c => ({
        campaign_id: c.campaign_id, campaign_name: c.campaign_name,
        spend: c.spend, impressions: c.impressions, clicks: c.clicks,
        ctr: c.ctr, cpc: c.cpc, reach: c.reach, frequency: c.frequency,
        leads: getAction(c.actions,'lead'), cpl: getCPA(c.cost_per_action_type,'lead') }));
      return { content: [{ type: 'text', text: JSON.stringify({ data: out, period: {since:s,until:u} }, null, 2) }] };
    });

  server.tool('get_campaign_insights', 'Métricas detalladas de una campaña de REMA: leads, CPL, CTR, alcance, frecuencia.',
    { campaign_id: z.string(), since: z.string().optional(), until: z.string().optional() },
    async ({ campaign_id, since, until }) => {
      const s = since || firstOfMonth(), u = until || today();
      const d = await fetchMeta(`/${campaign_id}/insights`, {
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type',
        time_range: JSON.stringify({ since: s, until: u }) });
      const r = (d.data||[])[0] || {};
      return { content: [{ type: 'text', text: JSON.stringify({
        campaign_id: r.campaign_id, campaign_name: r.campaign_name,
        spend: r.spend, impressions: r.impressions, clicks: r.clicks,
        ctr: r.ctr, cpc: r.cpc, reach: r.reach, frequency: r.frequency,
        leads: getAction(r.actions,'lead'), cpl: getCPA(r.cost_per_action_type,'lead'),
        period: {since:s,until:u} }, null, 2) }] };
    });

  server.tool('get_adsets', 'Ad sets de una campaña de REMA con presupuesto y segmentación.',
    { campaign_id: z.string() },
    async ({ campaign_id }) => {
      const d = await fetchMeta(`/${campaign_id}/adsets`, {
        fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,start_time', limit: 50 });
      return { content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] };
    });

  server.tool('get_ads', 'Anuncios individuales de una campaña o ad set de REMA.',
    { campaign_id: z.string().optional(), adset_id: z.string().optional() },
    async ({ campaign_id, adset_id }) => {
      const ep = adset_id ? `/${adset_id}/ads` : campaign_id ? `/${campaign_id}/ads` : null;
      if (!ep) return { content: [{ type: 'text', text: '{"error":"Se requiere campaign_id o adset_id"}' }] };
      const d = await fetchMeta(ep, { fields: 'id,name,status,creative{id,name,title,body,image_url}', limit: 50 });
      return { content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] };
    });

  server.tool('get_ads_insights', 'Métricas por anuncio de REMA: leads, CPL, CTR, hook rate.',
    { campaign_id: z.string(), since: z.string().optional(), until: z.string().optional() },
    async ({ campaign_id, since, until }) => {
      const s = since || firstOfMonth(), u = until || today();
      const d = await fetchMeta(`/${campaign_id}/insights`, {
        fields: 'ad_id,ad_name,spend,impressions,clicks,ctr,cpc,reach,actions,cost_per_action_type',
        level: 'ad', time_range: JSON.stringify({ since: s, until: u }), limit: 50 });
      const out = (d.data||[]).map(ad => {
        const vv = parseInt(getAction(ad.actions,'video_view')||'0');
        const imp = parseInt(ad.impressions||'0');
        return { ad_id: ad.ad_id, ad_name: ad.ad_name, spend: ad.spend,
          impressions: ad.impressions, clicks: ad.clicks, ctr: ad.ctr,
          reach: ad.reach, leads: getAction(ad.actions,'lead'),
          cpl: getCPA(ad.cost_per_action_type,'lead'),
          hook_rate: imp > 0 ? ((vv/imp)*100).toFixed(2)+'%' : 'N/A' }; });
      return { content: [{ type: 'text', text: JSON.stringify({ data: out, period: {since:s,until:u} }, null, 2) }] };
    });

  return server;
}

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

app.get('/', (_req, res) => res.json({ status: 'ok', server: 'rema-meta-ads MCP', version: '1.0.0' }));

const sessions = new Map();

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId).handleRequest(req, res, req.body);
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
        console.log('Nueva sesion MCP:', id);
      },
    });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    const server = buildMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('POST /mcp error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    if (!sessionId || !sessions.has(sessionId)) return res.status(400).json({ error: 'Sesion no encontrada' });
    await sessions.get(sessionId).handleRequest(req, res);
  } catch (err) {
    console.error('GET /mcp error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.delete('/mcp', (req, res) => {
  const id = req.headers['mcp-session-id'];
  if (id) sessions.delete(id);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`REMA Meta Ads MCP - puerto ${PORT}`);
  console.log(`Endpoint: https://msprema.onrender.com/mcp`);
  console.log(`Cuenta: ${AD_ACCOUNT_ID}`);
});
