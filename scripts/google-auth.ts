/**
 * Obtains a Google OAuth refresh token for the platform owner's account.
 *
 *   1. In Google Cloud Console enable "Google Sheets API" and "Google Drive API".
 *   2. Create an OAuth client of type "Desktop app"; put its ID/secret in .env.
 *   3. Run `npm run google:auth`, sign in, and copy the printed GOOGLE_REFRESH_TOKEN into .env.
 */
import { createServer } from "http";
import { OAuth2Client } from "google-auth-library";

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"];

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT);
const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

const server = createServer(async (req, res) => {
  const reqUrl = new URL(req.url ?? "/", REDIRECT);
  if (reqUrl.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const code = reqUrl.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end(`Authorization failed: ${reqUrl.searchParams.get("error") ?? "no code"}`);
    return;
  }
  try {
    const { tokens } = await client.getToken(code);
    res.writeHead(200, { "content-type": "text/plain" }).end("Done. You can close this tab and return to the terminal.");
    if (!tokens.refresh_token) {
      console.error("\nNo refresh token returned. Remove the app at https://myaccount.google.com/permissions and retry.");
    } else {
      console.log(`\nAdd this line to web/.env:\n\nGOOGLE_REFRESH_TOKEN="${tokens.refresh_token}"\n`);
    }
  } catch (error) {
    res.writeHead(500).end("Token exchange failed; see terminal.");
    console.error(error);
  } finally {
    server.close();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Open this URL in your browser and sign in with the account that owns the Sheet and Drive folder:\n\n${url}\n`);
});
