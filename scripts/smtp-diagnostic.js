const fs = require('fs');
const nodemailer = require('nodemailer');

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2];
}

console.log('MAIL_DRIVER=' + env.MAIL_DRIVER);
console.log('SMTP_HOST=' + env.SMTP_HOST);
console.log('SMTP_USER=' + env.SMTP_USER);
console.log('SMTP_PASS_LEN=' + (env.SMTP_PASS || '').length);
console.log('MAIL_FROM=' + env.MAIL_FROM);

const from = env.MAIL_FROM || env.SMTP_FROM;
const to = process.argv[2] || from;

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT || 587),
  secure: false,
  requireTLS: true,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

(async () => {
  try {
    await transport.verify();
    console.log('SMTP_VERIFY=OK');
  } catch (e) {
    console.log('SMTP_VERIFY=FAIL ' + e.message);
    process.exit(1);
  }

  try {
    const info = await transport.sendMail({
      from: `"AutoWave" <${from}>`,
      to,
      subject: 'AutoWave SMTP diagnostic ' + new Date().toISOString(),
      text: 'Diagnostic send from local micro-saas-api .env',
    });
    console.log('SMTP_SEND=OK messageId=' + info.messageId);
    console.log('SMTP_ACCEPTED=' + JSON.stringify(info.accepted));
    console.log('SMTP_REJECTED=' + JSON.stringify(info.rejected));
    console.log('SMTP_RESPONSE=' + String(info.response || ''));
  } catch (e) {
    console.log('SMTP_SEND=FAIL ' + e.message);
    if (e.responseCode) console.log('SMTP_CODE=' + e.responseCode);
    if (e.response) console.log('SMTP_RESPONSE=' + e.response);
    process.exit(2);
  }
})();
