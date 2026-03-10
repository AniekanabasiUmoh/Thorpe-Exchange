'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type TransactionData = {
    day: string;
    transactions: number;
};

// Mock data for the 7-day chart
const MOCK_DATA: TransactionData[] = [
    { day: 'Mon', transactions: 12 },
    { day: 'Tue', transactions: 19 },
    { day: 'Wed', transactions: 15 },
    { day: 'Thu', transactions: 25 },
    { day: 'Fri', transactions: 22 },
    { day: 'Sat', transactions: 30 },
    { day: 'Sun', transactions: 42 },
];

export function TransactionsChart({ data = MOCK_DATA }: { data?: TransactionData[] }) {
    return (
        <div className="h-72 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis
                        dataKey="day"
                        stroke="#94a3b8"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        stroke="#94a3b8"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}`}
                    />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        itemStyle={{ color: '#f8fafc' }}
                    />
                    <Line
                        type="monotone"
                        dataKey="transactions"
                        stroke="#3b82f6"
                        strokeWidth={3}
                        dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#1e293b' }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
