-- Stage 8D-2A verification
SELECT COUNT(*) AS personalCalendarRows, CASE WHEN COUNT(*)=0 THEN 'PASS' ELSE 'FAIL' END AS status FROM "UserCalendarEvent";
SELECT COUNT(*) AS passwordResetRows FROM "PasswordResetToken";
SELECT COUNT(*) AS emailVerificationRows FROM "EmailVerificationToken";
SELECT COUNT(*) AS oauthIdentityRows FROM "OAuthIdentity";
SELECT COUNT(*) AS sensitiveUserRows FROM "User" WHERE "passwordHash" IS NOT NULL OR "socketId" IS NOT NULL OR "deviceToken" IS NOT NULL OR "signature" IS NOT NULL;