import { ShieldAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function FailedWebhooksPage() {
    let fails: any[] = [];
    try {
        const res = await fetch('http://127.0.0.1:3000/api/admin/webhooks/failed', {
            cache: 'no-store',
            headers: {
                'x-admin-key': process.env.ADMIN_API_KEY || '',
            },
        });
        if (res.ok) {
            const data = await res.json();
            fails = data.fails || [];
        }
    } catch (err) {
        console.error('Fastify backend offline', err);
    }

    return (
        <div className="h-full flex flex-col gap-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white mb-2 flex items-center gap-3">
                    <ShieldAlert className="text-red-400" />
                    Failed Webhooks
                </h1>
                <p className="text-text-secondary">Dead letter queue for unresolved Breet transaction failures.</p>
            </div>

            <div className="glass-panel p-6 rounded-2xl flex flex-col flex-1 min-h-0 bg-surface/30 border border-border/50 overflow-auto">
                {fails.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 text-text-secondary">
                        <ShieldAlert size={48} className="mb-4 opacity-20" />
                        <p>No failed webhooks found.</p>
                    </div>
                ) : (
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="text-text-secondary border-b border-border/50">
                                <th className="pb-3 font-medium">Event ID</th>
                                <th className="pb-3 font-medium">Error</th>
                                <th className="pb-3 font-medium">Received At</th>
                                <th className="pb-3 font-medium text-right">Resolved</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/20">
                            {fails.map((f, i) => (
                                <tr key={i} className="group hover:bg-surface/50 transition-colors">
                                    <td className="py-4 font-mono text-xs max-w-[150px] truncate pr-4" title={f.event_id}>{f.event_id}</td>
                                    <td className="py-4 text-red-400 max-w-sm truncate pr-4" title={f.error}>{f.error}</td>
                                    <td className="py-4 text-text-secondary whitespace-nowrap">
                                        {new Date(f.received_at || f.created_at).toLocaleString()}
                                    </td>
                                    <td className="py-4 text-right">
                                        {f.reviewed ? '✅' : '❌'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
