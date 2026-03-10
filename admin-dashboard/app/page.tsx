import { Activity, CircleDollarSign, ShieldAlert, Users } from 'lucide-react';
import { TransactionsChart } from './components/Chart';

// Force dynamic so it fetches fresh on every page load
export const dynamic = 'force-dynamic';

export default async function DashboardOverview() {
    let metrics = {
        totalVolumeFormatted: 0,
        dailyProfitFormatted: 0,
        activeSessions: 0,
        blockedUsers: 0,
    };

    try {
        const res = await fetch('http://127.0.0.1:3000/api/admin/metrics', {
            cache: 'no-store',
            headers: {
                'x-admin-key': process.env.ADMIN_API_KEY || '',
            },
        });
        if (res.ok) {
            metrics = await res.json();
        }
    } catch (err) {
        // Falls back to zeros if backend is down
        console.error('Fastify backend offline', err);
    }

    let healthStatus = {
        status: 'degraded',
        services: { db: 'down', redis: 'down' }
    };
    try {
        const healthRes = await fetch('http://127.0.0.1:3000/health', {
            cache: 'no-store'
        });
        if (healthRes.ok) {
            healthStatus = await healthRes.json();
        } else {
            healthStatus.status = 'down';
        }
    } catch (err) {
        healthStatus.status = 'offline';
    }

    return (
        <div className="h-full flex flex-col gap-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Overview</h1>
                <p className="text-text-secondary">Track your bot's performance and system metrics.</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1 */}
                <div className="glass-panel p-5 rounded-2xl flex flex-col gap-1">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium text-text-secondary">Total Volume Today</span>
                        <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                            <CircleDollarSign size={20} />
                        </div>
                    </div>
                    <span className="text-3xl font-bold">₦{metrics.totalVolumeFormatted.toLocaleString()}</span>
                </div>

                {/* Card 2 */}
                <div className="glass-panel p-5 rounded-2xl flex flex-col gap-1">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium text-text-secondary">Daily Profit Margin</span>
                        <div className="p-2 bg-green-500/10 rounded-lg text-green-400">
                            <Activity size={20} />
                        </div>
                    </div>
                    <span className="text-3xl font-bold">₦{metrics.dailyProfitFormatted.toLocaleString()}</span>
                    <span className="text-xs text-green-400 flex items-center gap-1 mt-1">
                        + 0% from yesterday
                    </span>
                </div>

                {/* Card 3 */}
                <div className="glass-panel p-5 rounded-2xl flex flex-col gap-1">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium text-text-secondary">Active Sessions</span>
                        <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
                            <Users size={20} />
                        </div>
                    </div>
                    <span className="text-3xl font-bold">{metrics.activeSessions}</span>
                </div>

                {/* Card 4 */}
                <div className="glass-panel p-5 rounded-2xl flex flex-col gap-1">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium text-text-secondary">Blocked Users</span>
                        <div className="p-2 bg-red-500/10 rounded-lg text-red-400">
                            <ShieldAlert size={20} />
                        </div>
                    </div>
                    <span className="text-3xl font-bold">{metrics.blockedUsers}</span>
                </div>
            </div>

            {/* Charts & Bottom Tier */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">

                {/* Main Chart */}
                <div className="glass-panel p-6 rounded-2xl lg:col-span-2 flex flex-col">
                    <h2 className="text-lg font-bold">Transactions Activity</h2>
                    <p className="text-sm text-text-secondary">Successful transactions over the last 7 days</p>
                    <div className="flex-1 mt-4 border border-border/50 rounded-xl bg-surface/30 p-4">
                        <TransactionsChart />
                    </div>
                </div>

                {/* Recent Alerts / Quick Actions */}
                <div className="glass-panel p-6 rounded-2xl flex flex-col">
                    <h2 className="text-lg font-bold">System Status</h2>
                    <div className="mt-4 flex-1 space-y-4">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-surface/50 border border-border/50">
                            <span className="text-sm text-text-secondary">Fastify Backend</span>
                            <span className={`text-sm font-medium flex items-center gap-2 ${healthStatus.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                                {healthStatus.status === 'ok' && <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>}
                                {healthStatus.status === 'ok' ? 'Online' : 'Offline'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-surface/50 border border-border/50">
                            <span className="text-sm text-text-secondary">Database</span>
                            <span className={`text-sm font-medium ${healthStatus.services?.db === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                                {healthStatus.services?.db === 'ok' ? 'Connected' : 'Down'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-surface/50 border border-border/50">
                            <span className="text-sm text-text-secondary">Redis Store</span>
                            <span className={`text-sm font-medium ${healthStatus.services?.redis === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                                {healthStatus.services?.redis === 'ok' ? 'Connected' : 'Down'}
                            </span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
