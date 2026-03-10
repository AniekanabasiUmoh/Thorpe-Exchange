import { Search, Filter } from 'lucide-react';

export const dynamic = 'force-dynamic';

type Transaction = {
    id: string;
    user_id: string;
    status: string;
    asset_amount: number;
    asset_ticker: string;
    settled_fiat_amount: number;
    created_at: string;
    telegram_id: string | null;
    whatsapp_number: string | null;
};

export default async function TransactionsPage() {
    let transactions: Transaction[] = [];

    try {
        const res = await fetch('http://127.0.0.1:3000/api/admin/transactions', {
            cache: 'no-store',
            headers: { 'x-admin-key': process.env.ADMIN_API_KEY || '' },
        });
        if (res.ok) {
            const data = await res.json();
            transactions = data.transactions || [];
        }
    } catch (err) {
        console.error('Failed to fetch transactions', err);
    }

    return (
        <div className="h-full flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Transactions</h1>
                    <p className="text-text-secondary">View and manage all system transactions in real-time.</p>
                </div>

                <div className="flex gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
                        <input
                            type="text"
                            placeholder="Search ID or User..."
                            className="pl-10 pr-4 py-2 bg-surface/50 border border-border rounded-lg text-sm focus:outline-none focus:border-brand-500 transition-colors w-64"
                        />
                    </div>
                    <button className="flex items-center gap-2 px-4 py-2 glass-panel rounded-lg hover:bg-surface-hover transition-colors text-sm font-medium">
                        <Filter size={18} />
                        Filter
                    </button>
                </div>
            </div>

            {/* Table Container */}
            <div className="glass-panel rounded-2xl flex-1 overflow-hidden flex flex-col">
                <div className="overflow-x-auto flex-1">
                    <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase bg-surface/80 text-text-secondary sticky top-0 z-10 border-b border-border shadow-sm">
                            <tr>
                                <th className="px-6 py-4 font-medium">TX ID</th>
                                <th className="px-6 py-4 font-medium">User / Channel</th>
                                <th className="px-6 py-4 font-medium">Date & Time</th>
                                <th className="px-6 py-4 font-medium">Asset</th>
                                <th className="px-6 py-4 font-medium">Fiat Value (₦)</th>
                                <th className="px-6 py-4 font-medium text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {transactions.length > 0 ? (
                                transactions.map((tx) => (
                                    <tr key={tx.id} className="hover:bg-surface/30 transition-colors group cursor-pointer">
                                        <td className="px-6 py-4 font-mono text-text-secondary group-hover:text-white transition-colors">
                                            {tx.id.substring(0, 8)}...
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-medium text-white">
                                                {tx.telegram_id ? `TG: ${tx.telegram_id}` : (tx.whatsapp_number ? `WA: ${tx.whatsapp_number}` : tx.user_id.substring(0, 8))}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-text-secondary">
                                            {new Date(tx.created_at).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 font-medium">
                                                {tx.asset_amount} <span className="text-text-secondary">{tx.asset_ticker}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-medium">
                                            ₦{Number(tx.settled_fiat_amount).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold
                        ${tx.status === 'COMPLETED' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                                                    tx.status === 'EXPIRED' || tx.status === 'FAILED' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                                        'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'}`}>
                                                {tx.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-text-secondary">
                                        No transactions found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Footer */}
                <div className="p-4 border-t border-border flex items-center justify-between text-sm text-text-secondary">
                    <span>Showing {transactions.length} records</span>
                    <div className="flex gap-2">
                        <button className="px-3 py-1 rounded hover:bg-surface-hover transition-colors disabled:opacity-50" disabled>Previous</button>
                        <button className="px-3 py-1 rounded hover:bg-surface-hover transition-colors disabled:opacity-50" disabled>Next</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
