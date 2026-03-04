export const DEFAULT_EMAIL_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{{SUBJECT}}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f6fa;">
    <div style="display:none !important;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      {{PREVIEW_TEXT}}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fa;">
      <tr>
        <td align="center" style="padding:20px 10px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
            {{#if IMAGE_URL}}
            <tr>
              <td><img src="{{IMAGE_URL}}" alt="{{IMAGE_ALT}}" width="600" style="width:100%;max-width:600px;display:block;border:0;" /></td>
            </tr>
            {{/if}}
            <tr>
              <td style="padding:20px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.35;">{{HEADLINE}}</h1>
                <div style="font-size:15px;line-height:1.6;">{{BODY_HTML}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;">{{ACTION_TITLE}}</p>
                <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;font-style:italic;">"{{QUOTE_LINE}}"</p>
                <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;">{{RALLY_LINE}}</p>
                <p style="margin:0;font-size:15px;line-height:1.6;font-weight:700;">{{CTA_TEXT}}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;color:#6b7280;font-size:12px;line-height:1.5;">
                Asset library: <a href="{{ASSET_LIBRARY_URL}}" target="_blank">{{ASSET_LIBRARY_URL}}</a><br />
                <a href="{{UNSUBSCRIBE_LINK}}" target="_blank">Unsubscribe</a> |
                <a href="{{MANAGE_PREFS_URL}}" target="_blank">Manage preferences</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
