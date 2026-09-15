import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

/**
 * Auth.js v5 root. The MicrosoftEntraID provider picks up
 * AUTH_MICROSOFT_ENTRA_ID_{ID,SECRET,ISSUER} from the environment
 * (rendered by Terraform from secrets.enc.yaml).
 *
 * Auth.js also expects AUTH_SECRET (session encryption key) and honors
 * AUTH_TRUST_HOST=true — required behind App Service's reverse proxy
 * so the framework trusts the X-Forwarded-Host header.
 *
 * Single-operator gating is enforced at the AAD layer
 * (app_role_assignment_required = true), not here.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [MicrosoftEntraID],
  session: { strategy: "jwt" },
  trustHost: true,
});
