#!/usr/bin/env python3
"""
REMA Meta Ads MCP Server — HTTP/SSE transport
Acompañamiento médico con tirzepatida, Villavicencio.
Deployment en Render.com
"""

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import mcp.types as types
import uvicorn
from mcp.server import Server
from mcp.server.sse import SseServerTransport

# ─────────────────────────────────────────
# CREDENCIALES — variables de entorno en Render
# ─────────────────────────────────────────
META_ACCESS_TOKEN  = os.environ.get("META_ACCESS_TOKEN", "")
META_AD_ACCOUNT_ID = os.environ.get("META_AD_ACCOUNT_ID", "act_1243052028017945")
META_API_VERSION   = "v20.0"
META_BASE_URL      = f"https://graph.facebook.com/{META_API_VERSION}"


# ══════════════════════════════════════════
# UTILIDADES META ADS
# ══════════════════════════════════════════

def meta_get(endpoint: str, params: dict = {}) -> dict:
    p = dict(params)
    p["access_token"] = META_ACCESS_TOKEN
    safe_chars = '[]"{},:'
    parts = []
    for k, v in p.items():
        parts.append(urllib.parse.quote(str(k)) + "=" + urllib.parse.quote(str(v), safe=safe_chars))
    url = META_BASE_URL + "/" + endpoint + "?" + "&".join(parts)
    try:
        with urllib.request.urlopen(url) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Meta API error {e.code}: {e.read().decode()}")


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")

def month_start() -> str:
    return datetime.now().replace(day=1).strftime("%Y-%m-%d")

def get_action(actions: list, action_type: str) -> str:
    for a in (actions or []):
        if a.get("action_type") == action_type:
            return a.get("value", "0")
    return "0"

def get_cpa(cpa_list: list, action_type: str) -> str:
    for a in (cpa_list or []):
        if a.get("action_type") == action_type:
            return a.get("value", "N/A")
    return "N/A"


# ══════════════════════════════════════════
# SERVIDOR MCP
# ══════════════════════════════════════════

server = Server("rema-meta-ads")


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="get_campaigns",
            description="Lista las campañas de REMA en Meta Ads. Filtra por estado: ACTIVE, PAUSED o ARCHIVED.",
            inputSchema={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["ACTIVE", "PAUSED", "ARCHIVED"],
                        "default": "ACTIVE",
                        "description": "Estado de las campañas. Default: ACTIVE",
                    }
                },
            },
        ),
        types.Tool(
            name="get_all_campaigns_insights",
            description="Métricas de TODAS las campañas activas de REMA: leads generados, CPL, gasto, impresiones, CTR y frecuencia.",
            inputSchema={
                "type": "object",
                "properties": {
                    "since": {"type": "string", "description": "Fecha inicio YYYY-MM-DD. Default: inicio del mes."},
                    "until": {"type": "string", "description": "Fecha fin YYYY-MM-DD. Default: hoy."},
                },
            },
        ),
        types.Tool(
            name="get_campaign_insights",
            description="Métricas detalladas de una campaña específica de REMA: leads, CPL, gasto, CTR, alcance y frecuencia.",
            inputSchema={
                "type": "object",
                "properties": {
                    "campaign_id": {"type": "string", "description": "ID numérico de la campaña"},
                    "since": {"type": "string", "description": "Fecha inicio YYYY-MM-DD. Default: inicio del mes."},
                    "until": {"type": "string", "description": "Fecha fin YYYY-MM-DD. Default: hoy."},
                },
                "required": ["campaign_id"],
            },
        ),
        types.Tool(
            name="get_adsets",
            description="Lista los ad sets de una campaña de REMA con presupuesto y segmentación.",
            inputSchema={
                "type": "object",
                "properties": {
                    "campaign_id": {"type": "string", "description": "ID de la campaña."}
                },
                "required": ["campaign_id"],
            },
        ),
        types.Tool(
            name="get_ads",
            description="Lista los anuncios individuales de una campaña o ad set de REMA.",
            inputSchema={
                "type": "object",
                "properties": {
                    "campaign_id": {"type": "string"},
                    "adset_id":    {"type": "string"},
                },
            },
        ),
        types.Tool(
            name="get_ads_insights",
            description="Métricas por anuncio individual de REMA: leads, CPL, CTR, hook rate. Identifica el creativo ganador.",
            inputSchema={
                "type": "object",
                "properties": {
                    "campaign_id": {"type": "string", "description": "ID de la campaña."},
                    "since": {"type": "string", "description": "Fecha inicio YYYY-MM-DD. Default: inicio del mes."},
                    "until": {"type": "string", "description": "Fecha fin YYYY-MM-DD. Default: hoy."},
                },
                "required": ["campaign_id"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    mstart = month_start()
    hoy    = today()

    if name == "get_campaigns":
        status = arguments.get("status", "ACTIVE")
        data = meta_get(
            f"{META_AD_ACCOUNT_ID}/campaigns",
            {"effective_status": f'["{status}"]',
             "fields": "id,name,status,objective,start_time,stop_time,daily_budget,lifetime_budget",
             "limit": "50"},
        )
        return [types.TextContent(type="text", text=json.dumps(data, indent=2, ensure_ascii=False))]

    elif name == "get_all_campaigns_insights":
        since = arguments.get("since", mstart)
        until = arguments.get("until", hoy)
        data = meta_get(
            f"{META_AD_ACCOUNT_ID}/insights",
            {"fields": "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type",
             "level": "campaign",
             "time_range": json.dumps({"since": since, "until": until}),
             "limit": "50"},
        )
        out = []
        for c in data.get("data", []):
            out.append({
                "campaign_id":   c.get("campaign_id"),
                "campaign_name": c.get("campaign_name"),
                "spend":         c.get("spend"),
                "impressions":   c.get("impressions"),
                "clicks":        c.get("clicks"),
                "ctr":           c.get("ctr"),
                "cpc":           c.get("cpc"),
                "reach":         c.get("reach"),
                "frequency":     c.get("frequency"),
                "leads":         get_action(c.get("actions", []), "lead"),
                "cpl":           get_cpa(c.get("cost_per_action_type", []), "lead"),
            })
        return [types.TextContent(type="text", text=json.dumps({"data": out, "period": {"since": since, "until": until}}, indent=2, ensure_ascii=False))]

    elif name == "get_campaign_insights":
        campaign_id = arguments["campaign_id"]
        since = arguments.get("since", mstart)
        until = arguments.get("until", hoy)
        data = meta_get(
            f"{campaign_id}/insights",
            {"fields": "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type",
             "time_range": json.dumps({"since": since, "until": until})},
        )
        r = data.get("data", [{}])[0] if data.get("data") else {}
        result = {
            "campaign_id":   r.get("campaign_id"),
            "campaign_name": r.get("campaign_name"),
            "spend":         r.get("spend"),
            "impressions":   r.get("impressions"),
            "clicks":        r.get("clicks"),
            "ctr":           r.get("ctr"),
            "cpc":           r.get("cpc"),
            "reach":         r.get("reach"),
            "frequency":     r.get("frequency"),
            "leads":         get_action(r.get("actions", []), "lead"),
            "cpl":           get_cpa(r.get("cost_per_action_type", []), "lead"),
            "period":        {"since": since, "until": until},
        }
        return [types.TextContent(type="text", text=json.dumps(result, indent=2, ensure_ascii=False))]

    elif name == "get_adsets":
        data = meta_get(
            f"{META_AD_ACCOUNT_ID}/adsets",
            {"campaign_id": arguments["campaign_id"],
             "fields": "id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,start_time"},
        )
        return [types.TextContent(type="text", text=json.dumps(data, indent=2, ensure_ascii=False))]

    elif name == "get_ads":
        campaign_id = arguments.get("campaign_id")
        adset_id    = arguments.get("adset_id")
        if adset_id:
            endpoint = f"{adset_id}/ads"
        elif campaign_id:
            endpoint = f"{campaign_id}/ads"
        else:
            return [types.TextContent(type="text", text='{"error":"Se requiere campaign_id o adset_id"}')]
        data = meta_get(endpoint, {"fields": "id,name,status,creative{id,name,title,body,image_url}", "limit": "50"})
        return [types.TextContent(type="text", text=json.dumps(data, indent=2, ensure_ascii=False))]

    elif name == "get_ads_insights":
        campaign_id = arguments["campaign_id"]
        since = arguments.get("since", mstart)
        until = arguments.get("until", hoy)
        data = meta_get(
            f"{campaign_id}/insights",
            {"fields": "ad_id,ad_name,spend,impressions,clicks,ctr,cpc,reach,actions,cost_per_action_type",
             "level": "ad",
             "time_range": json.dumps({"since": since, "until": until}),
             "limit": "50"},
        )
        out = []
        for ad in data.get("data", []):
            imp = int(ad.get("impressions", 0) or 0)
            vv  = int(get_action(ad.get("actions", []), "video_view") or 0)
            out.append({
                "ad_id":      ad.get("ad_id"),
                "ad_name":    ad.get("ad_name"),
                "spend":      ad.get("spend"),
                "impressions": ad.get("impressions"),
                "clicks":     ad.get("clicks"),
                "ctr":        ad.get("ctr"),
                "reach":      ad.get("reach"),
                "leads":      get_action(ad.get("actions", []), "lead"),
                "cpl":        get_cpa(ad.get("cost_per_action_type", []), "lead"),
                "hook_rate":  f"{round(vv/imp*100, 2)}%" if imp > 0 else "N/A",
            })
        return [types.TextContent(type="text", text=json.dumps({"data": out, "period": {"since": since, "until": until}}, indent=2, ensure_ascii=False))]

    else:
        raise ValueError(f"Herramienta desconocida: {name}")


# ══════════════════════════════════════════
# HTTP / SSE TRANSPORT — ASGI puro (igual que el servidor de zapatos)
# ══════════════════════════════════════════

sse = SseServerTransport("/messages/")


async def app(scope, receive, send):
    """
    ASGI app sin Starlette para evitar el bug de NoneType en el handler de mensajes.
    """
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
        return

    path   = scope.get("path", "/")
    method = scope.get("method", "GET").upper()

    if path == "/":
        body = b"OK - REMA Meta Ads MCP Server running"
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"text/plain; charset=utf-8")]})
        await send({"type": "http.response.body", "body": body})

    elif path == "/sse" and method == "GET":
        async with sse.connect_sse(scope, receive, send) as streams:
            await server.run(streams[0], streams[1], server.create_initialization_options())

    elif path.startswith("/messages/"):
        await sse.handle_post_message(scope, receive, send)

    else:
        await send({"type": "http.response.start", "status": 404,
                    "headers": [(b"content-type", b"text/plain")]})
        await send({"type": "http.response.body", "body": b"Not found"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
