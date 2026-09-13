-- ============================================================================
-- Email OTP + disposable-domain blocklist
--
-- The claim email now carries a 6-digit code as well as the link, for humans
-- reading it on another device (or behind a link-scanner). Owner emails must
-- reach a real person, so throwaway domains are refused; the list lives here
-- so it can grow without a deploy (workers/scripts/block-email-domain.sh).
-- ============================================================================

-- One live challenge per claim code; replaced on every new request
CREATE TABLE IF NOT EXISTS claim_email_challenges (
  claim_code TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,        -- sha256(code:email:otp)
  attempts INTEGER DEFAULT 0,    -- wrong guesses; the challenge dies at 5
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Suffix-matched: blocking example.com also blocks *.example.com
CREATE TABLE IF NOT EXISTS blocked_email_domains (
  domain TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO blocked_email_domains (domain, reason) VALUES
  ('mailinator.com', 'disposable'), ('mailinator.net', 'disposable'), ('mailinator2.com', 'disposable'),
  ('guerrillamail.com', 'disposable'), ('guerrillamail.net', 'disposable'), ('guerrillamail.org', 'disposable'),
  ('guerrillamail.biz', 'disposable'), ('guerrillamail.de', 'disposable'), ('guerrillamailblock.com', 'disposable'),
  ('sharklasers.com', 'disposable'), ('grr.la', 'disposable'), ('spam4.me', 'disposable'),
  ('10minutemail.com', 'disposable'), ('10minutemail.net', 'disposable'), ('10minemail.com', 'disposable'),
  ('10minutemail.co.uk', 'disposable'), ('10minutemail.de', 'disposable'), ('20minutemail.com', 'disposable'),
  ('temp-mail.org', 'disposable'), ('temp-mail.io', 'disposable'), ('tempmail.com', 'disposable'),
  ('tempmail.net', 'disposable'), ('tempmail.dev', 'disposable'), ('tempmailo.com', 'disposable'),
  ('tempmailaddress.com', 'disposable'), ('tempr.email', 'disposable'), ('temp-inbox.com', 'disposable'),
  ('tempinbox.com', 'disposable'), ('tempail.com', 'disposable'), ('tempm.com', 'disposable'),
  ('yopmail.com', 'disposable'), ('yopmail.fr', 'disposable'), ('yopmail.net', 'disposable'),
  ('cool.fr.nf', 'disposable'), ('jetable.fr.nf', 'disposable'), ('nospam.ze.tc', 'disposable'),
  ('dispostable.com', 'disposable'), ('trashmail.com', 'disposable'), ('trashmail.de', 'disposable'),
  ('trashmail.net', 'disposable'), ('trashmail.me', 'disposable'), ('trash-mail.com', 'disposable'),
  ('trashmail.at', 'disposable'), ('trashmail.io', 'disposable'), ('trashmail.xyz', 'disposable'),
  ('getnada.com', 'disposable'), ('nada.email', 'disposable'), ('getairmail.com', 'disposable'),
  ('throwawaymail.com', 'disposable'), ('throwam.com', 'disposable'), ('throwaway.email', 'disposable'),
  ('maildrop.cc', 'disposable'), ('mohmal.com', 'disposable'), ('mohmal.im', 'disposable'),
  ('fakeinbox.com', 'disposable'), ('fakemail.net', 'disposable'), ('fakemailgenerator.com', 'disposable'),
  ('mailnesia.com', 'disposable'), ('mailcatch.com', 'disposable'), ('mailexpire.com', 'disposable'),
  ('mailforspam.com', 'disposable'), ('mailnull.com', 'disposable'), ('mailsac.com', 'disposable'),
  ('mailtemp.info', 'disposable'), ('mail-temp.com', 'disposable'), ('mail-temporaire.fr', 'disposable'),
  ('mytemp.email', 'disposable'), ('mytrashmail.com', 'disposable'), ('mailmoat.com', 'disposable'),
  ('emailondeck.com', 'disposable'), ('emailfake.com', 'disposable'), ('email-fake.com', 'disposable'),
  ('emailtemporario.com.br', 'disposable'), ('generator.email', 'disposable'), ('crazymailing.com', 'disposable'),
  ('discard.email', 'disposable'), ('discardmail.com', 'disposable'), ('discardmail.de', 'disposable'),
  ('spamgourmet.com', 'disposable'), ('spambox.us', 'disposable'), ('spamfree24.org', 'disposable'),
  ('spam.la', 'disposable'), ('spamherelots.com', 'disposable'), ('spamhereplease.com', 'disposable'),
  ('mintemail.com', 'disposable'), ('minuteinbox.com', 'disposable'), ('mailinater.com', 'disposable'),
  ('binkmail.com', 'disposable'), ('bobmail.info', 'disposable'), ('chammy.info', 'disposable'),
  ('devnullmail.com', 'disposable'), ('dodgeit.com', 'disposable'), ('dodgit.com', 'disposable'),
  ('e4ward.com', 'disposable'), ('filzmail.com', 'disposable'), ('fudgerub.com', 'disposable'),
  ('harakirimail.com', 'disposable'), ('incognitomail.org', 'disposable'), ('inboxkitten.com', 'disposable'),
  ('jetable.org', 'disposable'), ('jetable.com', 'disposable'), ('kasmail.com', 'disposable'),
  ('koszmail.pl', 'disposable'), ('lroid.com', 'disposable'), ('mailscrap.com', 'disposable'),
  ('mailzilla.com', 'disposable'), ('meltmail.com', 'disposable'), ('mierdamail.com', 'disposable'),
  ('mt2015.com', 'disposable'), ('mytempemail.com', 'disposable'), ('nomail.xl.cx', 'disposable'),
  ('notmailinator.com', 'disposable'), ('nowmymail.com', 'disposable'), ('objectmail.com', 'disposable'),
  ('owlpic.com', 'disposable'), ('pookmail.com', 'disposable'), ('proxymail.eu', 'disposable'),
  ('rcpt.at', 'disposable'), ('reallymymail.com', 'disposable'), ('safetymail.info', 'disposable'),
  ('sneakemail.com', 'disposable'), ('sogetthis.com', 'disposable'), ('spamavert.com', 'disposable'),
  ('spambog.com', 'disposable'), ('spambog.de', 'disposable'), ('spambog.ru', 'disposable'),
  ('spamex.com', 'disposable'), ('spamspot.com', 'disposable'), ('supergreatmail.com', 'disposable'),
  ('suremail.info', 'disposable'), ('tempemail.net', 'disposable'), ('tempemail.co.za', 'disposable'),
  ('tempomail.fr', 'disposable'), ('temporaryemail.net', 'disposable'), ('temporaryinbox.com', 'disposable'),
  ('thankyou2010.com', 'disposable'), ('tmail.ws', 'disposable'), ('tmailinator.com', 'disposable'),
  ('tradermail.info', 'disposable'), ('trbvm.com', 'disposable'), ('trialmail.de', 'disposable'),
  ('uggsrock.com', 'disposable'), ('veryrealemail.com', 'disposable'), ('wegwerfmail.de', 'disposable'),
  ('wegwerfmail.net', 'disposable'), ('wegwerfmail.org', 'disposable'), ('wh4f.org', 'disposable'),
  ('whyspam.me', 'disposable'), ('willselfdestruct.com', 'disposable'), ('yourdomain.com', 'disposable'),
  ('zoemail.org', 'disposable'), ('burnermail.io', 'disposable'), ('33mail.com', 'disposable'),
  ('anonbox.net', 'disposable'), ('anonymbox.com', 'disposable'), ('mailhazard.com', 'disposable'),
  ('mailme.lv', 'disposable'), ('mailmetrash.com', 'disposable'), ('mailshell.com', 'disposable'),
  ('mailslite.com', 'disposable'), ('mailtome.de', 'disposable'), ('moakt.com', 'disposable'),
  ('moakt.ws', 'disposable'), ('tmails.net', 'disposable'), ('tmpmail.org', 'disposable'),
  ('tmpmail.net', 'disposable'), ('tmpeml.info', 'disposable'), ('tmpbox.net', 'disposable'),
  ('emailtemp.org', 'disposable'), ('luxusmail.org', 'disposable'), ('inboxbear.com', 'disposable'),
  ('cuvox.de', 'disposable'), ('dayrep.com', 'disposable'), ('einrot.com', 'disposable'),
  ('fleckens.hu', 'disposable'), ('gustr.com', 'disposable'), ('jourrapide.com', 'disposable'),
  ('rhyta.com', 'disposable'), ('superrito.com', 'disposable'), ('teleworm.us', 'disposable'),
  ('armyspy.com', 'disposable'), ('example.com', 'placeholder'), ('example.org', 'placeholder'),
  ('example.net', 'placeholder'), ('test.com', 'placeholder'), ('localhost', 'placeholder');
