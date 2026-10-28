const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const enc = new TextEncoder();

/** Minimal RFC 5322 message: UTF-8 subject (RFC 2047) and a base64 text body, CRLF line endings. */
export function buildMime(o: { from: string; to: string; subject: string; body: string; now: Date; messageId: string }): string {
  const body = b64(enc.encode(o.body)).replace(/.{1,76}/g, '$&\r\n').trimEnd();
  return [
    `From: ${o.from}`,
    `To: ${o.to}`,
    `Subject: =?UTF-8?B?${b64(enc.encode(o.subject))}?=`,
    `Date: ${o.now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${o.messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    '',
  ].join('\r\n');
}
