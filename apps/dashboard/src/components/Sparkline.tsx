"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

interface SparklineProps {
  data: Array<{ date: string; eur: number }>;
}

/**
 * Tiny inline sparkline for the 30-day cost trend on the overview.
 * Client component because recharts mounts in the DOM. The server
 * passes pre-fetched buckets in `data`.
 */
export function Sparkline({ data }: SparklineProps) {
  return (
    <ResponsiveContainer width="100%" height={64}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide />
        <Tooltip
          cursor={{ stroke: "#3f3f46", strokeWidth: 1 }}
          contentStyle={{
            background: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: 6,
            fontSize: 12,
          }}
          labelStyle={{ color: "#a1a1aa" }}
          itemStyle={{ color: "#e4e4e7" }}
          formatter={(value) => {
            const n = typeof value === "number" ? value : Number(value);
            return [`€${n.toFixed(4)}`, "cost"];
          }}
        />
        <Area
          type="monotone"
          dataKey="eur"
          stroke="#60a5fa"
          strokeWidth={1.5}
          fill="url(#sparkfill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
