import type { Adapter } from "@sveltejs/kit";
export interface Config {
    isr?: {
        expiration: number;
        bypassToken?: string;
        allowQuery?: string[];
    };
}
export default function denoAdapter(): Adapter;
