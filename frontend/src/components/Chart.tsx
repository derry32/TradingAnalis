'use client';

import { AdvancedRealTimeChart } from "react-ts-tradingview-widgets";

export default function Chart() {
  return (
    <div className="w-full h-[710px] rounded-xl overflow-hidden shadow-2xl border border-gray-800">
      <AdvancedRealTimeChart 
        symbol="OANDA:XAUUSD"
        interval="5"
        theme="dark"
        autosize
        timezone="Asia/Jakarta"
        locale="en"
        hide_top_toolbar={false}
        hide_legend={false}
        save_image={false}
        allow_symbol_change={false}
      />
    </div>
  );
}
