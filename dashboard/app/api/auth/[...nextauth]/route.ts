import NextAuth from 'next-auth'
import DiscordProvider from 'next-auth/providers/discord'

const handler = NextAuth({
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      // Add Discord user ID to session
      if (token.sub) {
        session.user.id = token.sub
      }
      return session
    },
  },
  cookies: {aimport NextAuth, { NextAuthOptions } from 'next-auth'
import DiscordProvider from 'next-auth/providers/discord'

/**
 * Ortam bilgileri
 */
const NODE_ENV = process.env.NODE_ENV
const isProd = NODE_ENV === 'production'
const isDev = NODE_ENV === 'development'

// Vercel/Prod URL'in mutlaka https olmalı
const NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000'
const useSecureCookies = NEXTAUTH_URL.startsWith('https://') || isProd

// Debug: sadece development'ta açık olsun.
// NEXTAUTH_DEBUG=true ise override eder; aksi halde dev'de true, prod'da false.
const DEBUG =
  (process.env.NEXTAUTH_DEBUG
    ? process.env.NEXTAUTH_DEBUG === 'true'
    : isDev)

/**
 * Zorunlu env kontrolleri (erken ve anlaşılır hata)
 */
function required(name: string) {
  const v = process.env[name]
  if (!v || !v.trim()) {
    throw new Error(`[auth] Missing required env: ${name}`)
  }
  return v
}

const DISCORD_CLIENT_ID = required('DISCORD_CLIENT_ID')
const DISCORD_CLIENT_SECRET = required('DISCORD_CLIENT_SECRET')
const NEXTAUTH_SECRET = required('NEXTAUTH_SECRET')

/**
 * NextAuth seçenekleri
 */
export const authOptions: NextAuthOptions = {
  providers: [
    DiscordProvider({
      clientId: DISCORD_CLIENT_ID,
      clientSecret: DISCORD_CLIENT_SECRET,
      // İhtiyaç oldukça scope ekleyebilirsin (varsayılan: identify, email yok)
      // authorization: { params: { scope: 'identify email guilds' } },
      // profile(profile) { ... } // custom mapping gerekirse
    }),
  ],

  // JWT stratejisi; Discord user id'yi session.user.id olarak koruyoruz
  session: { strategy: 'jwt' },

  callbacks: {
    async jwt({ token, account, profile }) {
      // İlk girişte Discord id (sub) zaten token.sub içinde olur; saklayalım
      // Ek alanlar gerekiyorsa burada ekleyebilirsin (ör. guilds vs.)
      return token
    },
    async session({ session, token }) {
      // Tip: next-auth varsayılanında session.user.id tanımlı değil
      // (Aşağıdaki d.ts dosyasıyla type-augmentation yapacağız)
      if (token?.sub) {
        ;(session.user as any).id = token.sub
      }
      return session
    },
  },

  // Prod'da güvenli cookie; dev'de httpOnly ama secure=false
  cookies: {
    pkceCodeVerifier: {
      name: 'next-auth.pkce.code_verifier',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
    state: {
      name: 'next-auth.state',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
  },

  // NextAuth v5 (App Router) — Vercel gibi ortamlarda host güveni:
  trustHost: true,

  // UYARIYI KALDIRIR: prod'da DEBUG=false; dev'de true
  debug: DEBUG,

  // (İsteğe bağlı) kendi logger'ını verip seviyeyi sınırlayabilirsin
  // logger: {
  //   warn(code, ...message) { console.warn('[next-auth:warn]', code, ...message) },
  //   error(code, ...message) { console.error('[next-auth:error]', code, ...message) },
  //   debug(code, ...message) { if (DEBUG) console.debug('[next-auth:debug]', code, ...message) },
  // },

  // Güvenlik: secret zorunlu
  secret: NEXTAUTH_SECRET,
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }

    pkceCodeVerifier: {
      name: "next-auth.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false, // Set to true in production with HTTPS
      },
    },
    state: {
      name: "next-auth.state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false, // Set to true in production with HTTPS
      },
    },
  },
  debug: process.env.NODE_ENV === 'development',
})

export { handler as GET, handler as POST }