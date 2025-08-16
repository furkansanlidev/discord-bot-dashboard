import './globals.css'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import { NavigationBar } from './components/navigation'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Discord Bot Dashboard',
  description: 'Manage your Discord bot tasks and reminders with style',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full`}>
        <Providers>
          <div className="min-h-full bg-gray-50 dark:bg-gray-950 transition-colors duration-200">
            <NavigationBar />
            <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 animate-fade-in">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  )
}