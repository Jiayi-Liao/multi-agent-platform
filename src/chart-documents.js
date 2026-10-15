// Served HTML runs in an opaque-origin sandbox, including when opened directly.
export const CHART_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
export const MAX_HTML_BYTES = 2 * 1024 * 1024;
