# Daily Health web

Public static interface for a personal daily habit tracker. Hosted with GitHub Pages at https://health.theaubuchonfamily.com.

The Google Sheet and Apps Script backend are private and are not included in this repository. Reading or saving entries requires Google authorization and the backend owner's account. Public code alone provides no access to the data.

## Hosting

In repository Settings → Pages, publish **main / (root)**. Keep the custom domain `health.theaubuchonfamily.com` and enable HTTPS after its certificate is available.

IONOS DNS: CNAME `health` → `scottaubuchontaf.github.io`. The CNAME target must not contain a repository name or URL path.

## Google connection

`config.js` contains only public configuration: the site's origin, the Google OAuth **Web application client ID**, and the Apps Script **API executable deployment ID**. Empty identifiers leave the app locked until setup is complete. Never add client secrets, access tokens, refresh tokens, a data export, or Sheet contents to this repository.

The OAuth client and Apps Script must share one standard Google Cloud project with the Apps Script API enabled. Allow this exact JavaScript origin: `https://health.theaubuchonfamily.com`. The API executable must be restricted to **Only myself**, with owner checks in its server functions. The app requests the script's spreadsheet and account-email scopes.

Google Identity Services uses its browser token flow. Access tokens remain in memory and expire; reconnect from a button when needed. The app preserves pending save requests in memory for safe retries. Reloading or closing the page can discard an unconfirmed entry. There is no offline data cache.

## iPhone

Open the HTTPS custom domain in Safari, Share → Add to Home Screen, keeping Open as Web App on if shown. Install a fresh shortcut after switching from the older Google URL. The app serves a 180×180 Apple touch icon plus 192×192 and 512×512 manifest icons directly from its own domain. Final installation and Google popup behavior should be tested on the actual iPhone.

## Maintenance

The private source project builds this public bundle. Commit updated files to `main` to redeploy. Do not copy the entire private source project here. No build service, server secrets, Vercel, or Tiller integration is required.
