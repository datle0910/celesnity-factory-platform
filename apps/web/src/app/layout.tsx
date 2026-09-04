import type { Metadata } from 'next';
import { Nav } from './nav';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Celesnity Factory Platform',
  description: 'Factory data collection and production-line visibility for an industrial laundry',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
