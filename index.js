import * as cfg from "./config.js";

import SteamID from "steamid";

const api = "https://discordapp.com/api/v6";
const scope = "identify connections guilds.join";

// Cloudflare entrypoint
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  let params = new URL(request.url).searchParams;

  // If this is an OAuth2 error result
  if (params.has("error")) {
    return err(params.get("error_description"));
  }

  // If this isn't an OAuth2 result, redirect into OAuth2 flow
  if (!params.has("code")) {
    let params = new URLSearchParams({
      client_id: cfg.client_id,
      redirect_uri: cfg.redirect_uri,
      response_type: "code",
      scope
    });

    return Response.redirect(
      `https://discordapp.com/api/oauth2/authorize?${params.toString()}`
    );
  }

  // This is an OAuth2 result, fetch a token
  let token_resp = await fetch(`${api}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      code: params.get("code"),
      grant_type: "authorization_code",
      redirect_uri: cfg.redirect_uri,
      scope
    })
  });

  let token_json = await token_resp.json();

  if (!token_resp.ok) {
    return err(token_json.error_description)
  }

  let access_token = token_json.access_token;

  // We have the user's access_token, fetch their identity
  let ident_resp = await fetch(`${api}/users/@me`, {
    headers: { Authorization: `Bearer ${access_token}` }
  });

  let ident_json = await ident_resp.json();

  // unlikely
  if (!ident_resp.ok) {
    return err(ident_json.message);
  }

  let user_id = ident_json.id;

  // fetch their linked accounts
  let conn_resp = await fetch(`${api}/users/@me/connections`, {
    headers: { Authorization: `Bearer ${access_token}` }
  });

  let conn_json = await conn_resp.json();

  // unlikely
  if (!conn_resp.ok) {
    return err(conn_json.message);
  }

  let steam_conn = conn_json.find(c => c.type == "steam");

  if (steam_conn === undefined) {
    return err("You must link your Steam account in your Discord settings");
  }

  let broken_steam_id = new SteamID(steam_conn.id);
  broken_steam_id.instance = SteamID.Instance.DESKTOP;

  let steam_id = broken_steam_id.getSteamID64();
  let steam_resp = await fetch(`https://steamcommunity.com/profiles/${steam_id}?xml=1`)

  if (!steam_resp.ok) {
    return err("Invalid Steam response")
  }

  let steam_body = await steam_resp.text()

  if (steam_body.includes("<privacyMessage>")) {
    return err("Invalid Steam response")
  }

  // We verfied everything we want, we can let them join
  let add_resp = await fetch(
    `${api}/guilds/${cfg.guild_id}/members/${user_id}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${cfg.bot_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        access_token,
        roles: [cfg.role_id]
      })
    }
  );

  if (!add_resp.ok) {
    let add_json = await add_resp.json();

    return err(add_json.message);
  }

  // If they're already part of the server, give them the verification role
  if (add_resp.status == 204) {
    let role_resp = await fetch(
      `${api}/guilds/${cfg.guild_id}/members/${user_id}/roles/${cfg.role_id}`,
      {
        method: "PUT",
        headers: { Authorization: `Bot ${cfg.bot_token}` }
      }
    );

    if (!role_resp.ok) {
      let role_json = await role_resp.json();

      return err(role_json.message);
    }
  }

  let hook_resp = await fetch(`${api}/webhooks/${cfg.log_webhook_id}/${cfg.log_webhook_token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `<@${user_id}> linked to <https://steamcommunity.com/profiles/${steam_id}>`
    })
  });

  if (!hook_resp.ok) {
    return err(await hook_resp.text())
  }

  return new Response(`
    ~ NaCl.gg Discord Auth ~

    Authentication was successful
  `);
}

function err(message) {
  return new Response(`
    ~ NaCl.gg Discord Auth ~

    Ran into an error:
        ${message}

    It's very possible that trying again will fix it:
        ${cfg.redirect_uri}

    If it doesn't, please contact administrators
  `, {
    status: 400
  })
}
