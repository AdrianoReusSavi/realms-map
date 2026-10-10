export interface BlockState {
    readonly id: string;
    readonly properties: Readonly<Record<string, string>>;
}