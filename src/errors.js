// Raw FFmpeg / yt-dlp failures → short codes the UI explains in the user's language (err.* in src/locales).
// Errors that already are codes ("CANCELLED", "DISK_FULL:12") pass through; unknown messages stay as they are
// (the full output is in main.log).
const RULES = [
  [/No space left on device|not enough space on the disk|ENOSPC/i, 'NO_SPACE'],
  [/Permission denied|Access is denied|EACCES|EPERM|Operation not permitted/i, 'ACCESS_DENIED'],
  [/Invalid data found when processing input|moov atom not found|could not find codec parameters|Invalid NAL unit|corrupt/i, 'CORRUPT'],
  // yt-dlp. Age before bot: both say "Sign in to confirm".
  [/confirm your age|age[- ]restricted|inappropriate for some users/i, 'YT_AGE'],
  [/not a bot|Sign in to confirm/i, 'YT_BOT'],
  [/members[- ]only|Join this channel|requires? (a )?(premium|subscription)/i, 'YT_MEMBERS'],
  [/available in your country|geo[- ]?restrict/i, 'YT_GEO'],
  [/Private video|Video unavailable|This video is( no longer)? unavailable|has been removed|account .*terminated/i, 'YT_UNAVAILABLE'],
  [/HTTP Error 429|Too Many Requests/i, 'YT_RATE'],
  [/Unsupported URL/i, 'YT_UNSUPPORTED'],
  [/Requested format is not available/i, 'YT_FORMAT'],
  [/Unable to download (webpage|API page)|getaddrinfo|Failed to resolve|Name or service not known|timed out|Connection (refused|reset|aborted)|Network is unreachable|urlopen error|No route to host/i, 'NETWORK'],
  [/No such file or directory|ENOENT/i, 'NOT_FOUND'],
];

function readable(e) {
  const message = String(e?.message ?? e);
  if (/^[A-Z][A-Z_]+(:.*)?$/.test(message)) return e instanceof Error ? e : new Error(message);
  const text = `${message}\n${e?.log || ''}`;
  const hit = RULES.find(([re]) => re.test(text));
  return hit ? Object.assign(new Error(hit[1]), { log: e?.log, raw: message }) : e instanceof Error ? e : new Error(message);
}

module.exports = { readable, RULES };
