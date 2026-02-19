// src/lib/settings.js
const VALID_DOW = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];

export function loadSettings(env) {
  const timezone = str(env.TIMEZONE) || "America/Chicago";

  const schedule = {
    generate: {
      dow: upper(str(env.SCHEDULE_GENERATE_DOW) || "FRIDAY"),
      time: str(env.SCHEDULE_GENERATE_TIME) || "09:00"
    },
    lock: {
      dow: upper(str(env.SCHEDULE_LOCK_DOW) || "TUESDAY"),
      time: str(env.SCHEDULE_LOCK_TIME) || "09:45"
    },
    send: {
      dow: upper(str(env.SCHEDULE_SEND_DOW) || "TUESDAY"),
      time: str(env.SCHEDULE_SEND_TIME) || "10:00"
    }
  };

  const mail = {
    senderMailbox: str(env.MAIL_SENDER_UPN) || "", // leave empty if you want to force it later
    replyTo: str(env.REPLY_TO) || ""
  };

  validate({ timezone, schedule, mail });

  return { timezone, schedule, mail };
}

function validate(cfg) {
  // Validate timezone early with Intl. If it's invalid, this throws.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: cfg.timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid TIMEZONE: "${cfg.timezone}"`);
  }

  for (const stage of ["generate", "lock", "send"]) {
    const s = cfg.schedule[stage];
    if (!VALID_DOW.includes(s.dow)) {
      throw new Error(`Invalid SCHEDULE_${stage.toUpperCase()}_DOW: "${s.dow}"`);
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) {
      throw new Error(`Invalid SCHEDULE_${stage.toUpperCase()}_TIME: "${s.time}" (expected HH:MM 24h)`);
    }
  }

  // Mailbox fields are allowed to be empty for now (since you're still stubbing send),
  // but we keep them here so wiring later is trivial.
}

function str(v) {
  return (v ?? "").toString().trim();
}

function upper(v) {
  return v.toUpperCase();
}