import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import { LayoutDashboard, ArrowRightLeft, ShieldAlert } from 'lucide-react';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
    title: 'Thorpe Exchange | Admin',
    description: 'Internal admin dashboard for Thorpe Exchange',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className="dark">
            <body className={`${inter.className} flex h-screen overflow-hidden`}>
                {/* Sidebar */}
                <aside className="w-64 glass-panel border-r border-t-0 border-l-0 border-b-0 flex flex-col hidden md:flex z-10">
                    <div className="p-6">
                        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                            Thorpe Admin
                        </h1>
                    </div>
                    <nav className="flex-1 px-4 space-y-2 mt-4">
                        <Link
                            href="/"
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-text-secondary hover:text-white hover:bg-surface-hover transition-colors"
                        >
                            <LayoutDashboard size={20} />
                            <span className="font-medium">Overview</span>
                        </Link>
                        <Link
                            href="/transactions"
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-text-secondary hover:text-white hover:bg-surface-hover transition-colors"
                        >
                            <ArrowRightLeft size={20} />
                            <span className="font-medium">Transactions</span>
                        </Link>
                        <Link
                            href="/failed"
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-text-secondary hover:text-white hover:bg-surface-hover transition-colors"
                        >
                            <ShieldAlert size={20} />
                            <span className="font-medium">Failed Webhooks</span>
                        </Link>
                    </nav>
                    <div className="p-4 border-t border-border mt-auto">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center font-bold text-sm">
                                A
                            </div>
                            <div>
                                <p className="text-sm font-medium">Admin User</p>
                                <p className="text-xs text-text-secondary">System Access</p>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Main Content Area */}
                <main className="flex-1 flex flex-col relative overflow-y-auto">
                    {/* Decorative background glow */}
                    <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-brand-600/10 blur-[120px] pointer-events-none" />
                    <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-600/10 blur-[120px] pointer-events-none" />

                    <div className="flex-1 p-6 md:p-8 z-10 relative">
                        {children}
                    </div>
                </main>
            </body>
        </html>
    );
}
