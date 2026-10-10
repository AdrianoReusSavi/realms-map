import type { NbtCompound, NbtList } from "../nbt/index.js";
import type { BlockState } from "./block-state.js";

export class BlockStatePalette {
    private readonly states: readonly BlockState[];

    public constructor(palette: NbtList) {
        this.states = palette.values.map((value) => {
            return this.parseBlockState(value);
        });
    }

    public get(index: number): BlockState {
        const state = this.states[index];

        if (state === undefined) {
            throw new Error(`Invalid block state palette index: ${index}.`);
        }

        return state;
    }

    public get size(): number {
        return this.states.length;
    }

    private parseBlockState(value: unknown): BlockState {
        if (typeof value === "string") {
            return {
                id: value,
                properties: {},
            };
        }

        if (
            typeof value !== "object" ||
            value === null ||
            Array.isArray(value)
        ) {
            throw new Error("Invalid block state palette entry.");
        }

        const compound = value as NbtCompound;
        const idValue = compound.id ?? compound[""] ?? compound.Name;

        if (typeof idValue !== "string") {
            throw new Error("Block state palette entry does not contain a valid id.");
        }

        const properties: Record<string, string> = {};
        const propertiesValue = compound.properties ?? compound.Properties;

        if (
            typeof propertiesValue === "object" &&
            propertiesValue !== null &&
            !Array.isArray(propertiesValue)
        ) {
            for (
                const [key, propertyValue]
                of Object.entries(propertiesValue)
            ) {
                if (typeof propertyValue !== "string") {
                    throw new Error(`Invalid block state property "${key}".`);
                }

                properties[key] = propertyValue;
            }
        }

        return {
                id: idValue,
                properties,
            };
    }

}