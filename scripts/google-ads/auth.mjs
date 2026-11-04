// Connexion unique à Google Ads : ouvre le consentement OAuth, récupère le jeton de rafraîchissement et l'écrit dans
// .env (sans l'afficher), puis liste les comptes Google Ads accessibles.
// Usage : node --env-file=.env scripts/google-ads/auth.mjs
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = 8765;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';
const { GOOGLE_ADS_CLIENT_ID: clientId, GOOGLE_ADS_CLIENT_SECRET: clientSecret, GOOGLE_ADS_DEVELOPER_TOKEN: developerToken } = process.env;
const version = process.env.GOOGLE_ADS_API_VERSION || 'v26';

if (!clientId || !clientSecret || !developerToken) {
  console.error('GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET et GOOGLE_ADS_DEVELOPER_TOKEN doivent être dans .env');
  process.exit(1);
}

function saveEnv(name, value) {
  const env = readFileSync('.env', 'utf8');
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  writeFileSync('.env', pattern.test(env) ? env.replace(pattern, line) : `${env.replace(/\n?$/, '\n')}${line}\n`);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent'
}).toString();

console.log(`Ouvrez ce lien dans votre navigateur :\n${authUrl}\n`);

const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Pas de réponse après 10 minutes')), 10 * 60_000);
  const server = createServer((req, res) => {
    const params = new URL(req.url ?? '/', REDIRECT).searchParams;
    if (!params.has('code') && !params.has('error')) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(params.has('code') ? '<p>Connexion Google Ads réussie, vous pouvez fermer cet onglet.</p>' : `<p>Refusé : ${params.get('error')}</p>`);
    clearTimeout(timer);
    server.close();
    params.has('code') ? resolve(params.get('code')) : reject(new Error(`Consentement refusé : ${params.get('error')}`));
  });
  server.listen(PORT, '127.0.0.1');
});

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT, grant_type: 'authorization_code' })
});
const tokens = await tokenResponse.json();
if (!tokenResponse.ok || !tokens.refresh_token) {
  console.error('Échange du code refusé :', tokens.error, tokens.error_description ?? '');
  process.exit(1);
}
saveEnv('GOOGLE_ADS_REFRESH_TOKEN', tokens.refresh_token);
console.log('Jeton de rafraîchissement enregistré dans .env (GOOGLE_ADS_REFRESH_TOKEN).');

const list = await fetch(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, {
  headers: { Authorization: `Bearer ${tokens.access_token}`, 'developer-token': developerToken }
});
const body = await list.json();
if (!list.ok) {
  console.error(`Liste des comptes refusée (HTTP ${list.status}) :`, JSON.stringify(body.error?.details ?? body.error ?? body).slice(0, 1500));
  process.exit(1);
}
console.log('Comptes Google Ads accessibles :', (body.resourceNames ?? []).map((name) => name.replace('customers/', '')).join(', ') || 'aucun');
