# REMA Meta Ads — Servidor MCP Remoto

Servidor MCP (Model Context Protocol) para consultar campañas de Meta Ads de la cuenta **REMA** en tiempo real desde Claude.ai.

## Herramientas disponibles

| Herramienta | Descripción |
|-------------|-------------|
| `get_campaigns` | Lista campañas por estado (ACTIVE, PAUSED, ARCHIVED) |
| `get_all_campaigns_insights` | Métricas de todas las campañas: leads, CPL, gasto |
| `get_campaign_insights` | Métricas detalladas de una campaña específica |
| `get_adsets` | Ad sets con presupuesto y segmentación |
| `get_ads` | Anuncios individuales |
| `get_ads_insights` | Métricas por anuncio: leads, CPL, CTR, hook rate |

## Variables de entorno requeridas

| Variable | Descripción |
|----------|-------------|
| `META_ACCESS_TOKEN` | Token del Sistema de Usuario de Meta Business Manager |
| `META_AD_ACCOUNT_ID` | ID de la cuenta publicitaria (formato `act_XXXXXXXXXX`) |

## Endpoint de conexión

Una vez desplegado en Render, conectar en Claude.ai → Settings → Integrations usando:
```
https://<tu-nombre>.onrender.com/sse
```
