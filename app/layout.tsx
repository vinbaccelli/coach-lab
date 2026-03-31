import './globals.css';

export const metadata = {
  title: 'Coach Lab',
};

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <header className="bg-blue-600 text-white p-4">
          <h1>🎬 Coach Lab</h1>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}