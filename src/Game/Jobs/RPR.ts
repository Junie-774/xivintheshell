import { ShellJob } from "../../Controller/Common";
import { Aspect, ResourceType, SkillName } from "../Common";
import { RPRResourceType, RPRSkillName } from "../Constants/RPR";
import { GameConfig } from "../GameConfig";
import { GameState } from "../GameState";
import { makeComboModifier, makePositionalModifier, Modifiers, Potency, PotencyModifier } from "../Potency";
import { CoolDown, getResourceInfo, makeResource, ResourceInfo } from "../Resources";
import { Ability, combineEffects, combinePredicatesAnd, ConditionalSkillReplace, CooldownGroupProperies, EffectFn, getBasePotency, makeAbility, makeResourceAbility, makeWeaponskill, NO_EFFECT, SkillsList, StatePredicate, Weaponskill } from "../Skills";
import { Trait, TraitName, Traits } from "../Traits";

function makeRPRResource(type: ResourceType, maxValue: number, params?: { timeout?: number, default?: number }) {
    makeResource(ShellJob.RPR, type, maxValue, params ?? {});
}

makeRPRResource(ResourceType.Soul, 100);
makeRPRResource(ResourceType.Shroud, 100);

makeRPRResource(ResourceType.DeathsDesign, 1, {})
makeRPRResource(ResourceType.SoulReaver, 2, { timeout: 30 });
makeRPRResource(ResourceType.EnhancedGibbet, 1, { timeout: 60 });
makeRPRResource(ResourceType.EnhancedGallows, 1, { timeout: 60 });
makeRPRResource(ResourceType.Executioner, 2, { timeout: 30 });

makeRPRResource(ResourceType.Enshrouded, 1, { timeout: 30 });
makeRPRResource(ResourceType.LemureShroud, 5, { timeout: 30 });
/* Not giving timeout for this because it needs to be zeroe-ed out when enshroud ends anyway
 * And I don't want the timeout to hide logic errors with that */
makeRPRResource(ResourceType.VoidShroud, 5); // Impossible for it to last 30s, but 30s is an upper bound
makeRPRResource(ResourceType.Oblatio, 1, { timeout: 30 });
makeRPRResource(ResourceType.EnhancedVoidReaping, 1, { timeout: 30 });
makeRPRResource(ResourceType.EnhancedCrossReaping, 1, { timeout: 30 });

makeRPRResource(ResourceType.IdealHost, 1, { timeout: 30 });
makeRPRResource(ResourceType.PerfectioOcculta, 1, { timeout: 30 });
makeRPRResource(ResourceType.PerfectioParata, 1, { timeout: 30 });

makeRPRResource(ResourceType.ArcaneCircle, 1, { timeout: 20 }); // 20.00s exactly
makeRPRResource(ResourceType.CircleOfSacrifice, 1, { timeout: 5 });
makeRPRResource(ResourceType.BloodsownCircle, 1, { timeout: 6 });
makeRPRResource(ResourceType.ImmortalSacrifice, 8, { timeout: 30 });

makeRPRResource(ResourceType.ArcaneCrest, 1, { timeout: 5 });
makeRPRResource(ResourceType.CrestOfTimeBorrowed, 1, { timeout: 5 });
makeRPRResource(ResourceType.CrestOfTimeReturned, 1, { timeout: 15 });

makeRPRResource(ResourceType.Soulsow, 1);
makeRPRResource(ResourceType.Threshold, 1, { timeout: 10 });
makeRPRResource(ResourceType.EnhancedHarpe, 1, { timeout: 10 });

makeRPRResource(ResourceType.RPRCombo, 2, { timeout: 30 });
makeRPRResource(RPRResourceType.RPRAoECombo, 1, { timeout: 30 });

export class RPRState extends GameState {
    constructor(config: GameConfig) {
        super(config);

        const soulSliceStacks = Traits.hasUnlocked(TraitName.TemperedSoul, config.level) ? 2 : 1;
        this.cooldowns.set(new CoolDown(ResourceType.cd_SoulSlice, 30, soulSliceStacks, soulSliceStacks));

        this.cooldowns.set(new CoolDown(ResourceType.cd_ArcaneCircle, 120, 1, 1));

        this.registerRecurringEvents();
    }

    refreshDeathsDesign() {
        const dd = this.resources.get(ResourceType.DeathsDesign);

        const newTime = Math.min(this.resources.timeTillReady(ResourceType.DeathsDesign) + 30, 60);
        if (dd.available(1)) {
            dd.overrideTimer(this, newTime);
            return;
        }

        dd.gain(1);
        this.resources.addResourceEvent({
            rscType: ResourceType.DeathsDesign,
            name: "drop Death's Design",
            delay: newTime,
            fnOnRsc: rsc => {
                rsc.consume(1);
            }
        })
    }

    setTimedResource(rscType: RPRResourceType, amount: number) {
        const duration = (getResourceInfo(ShellJob.RPR, rscType) as ResourceInfo).maxTimeout;
        const resource = this.resources.get(rscType);
        resource.consume(resource.availableAmount());
        resource.gain(amount);
        this.enqueueResourceDrop(rscType, duration);
    }

    processCombo(skill: SkillName) {
        const currCombo = this.resources.get(ResourceType.RPRCombo).availableAmount();
        const currAoeCombo = this.resources.get(ResourceType.RPRAoECombo).availableAmount();

        let [newCombo, newAoeCombo] = (new Map<SkillName, [number, number]>(
            [
                [SkillName.Slice, [1, 0]],
                [SkillName.WaxingSlice, [currCombo === 1 ? 2 : 0, 0]],
                [SkillName.InfernalSlice, [0, 0]],
                [SkillName.SpinningScythe, [0, 1]],
                [SkillName.InfernalScythe, [0, 0]],
            ]
        )).get(skill) ?? [currCombo, currAoeCombo]; // Any other gcd leaves combo unchanged

        this.setComboState(ResourceType.RPRCombo, newCombo);
        this.setComboState(ResourceType.RPRAoECombo, newAoeCombo);
    }

    processSoulGauge(skill: SkillName) {
        const soul = this.resources.get(ResourceType.Soul);
        if ([SkillName.Slice, SkillName.WaxingSlice, SkillName.InfernalSlice,
        SkillName.SpinningScythe, SkillName.InfernalScythe].includes(skill as RPRSkillName)) {

            soul.gain(10);
            return;
        }

        if ([SkillName.SoulSlice, SkillName.SoulScythe].includes(skill as RPRSkillName)) {
            soul.gain(50);
            return;
        }

        if ([SkillName.BloodStalk, SkillName.UnveiledGallows, SkillName.UnveiledGibbet, SkillName.GrimSwathe,
        SkillName.Gluttony].includes(skill as RPRSkillName)) {

            soul.consume(50);
        }
    }

    processShroudGauge(skill: SkillName) {
        const shroud = this.resources.get(ResourceType.Shroud);

        if (
            [
                SkillName.Gallows,
                SkillName.Gibbet,
                SkillName.ExecutionersGallows,
                SkillName.ExecutionersGibbet,
                SkillName.Guillotine,
                SkillName.ExecutionersGuillotine,
            ].includes(skill as RPRSkillName)
        ) {
            shroud.gain(10);
            return;
        }

        if (skill === SkillName.Enshroud
            && !this.resources.get(ResourceType.IdealHost).available(1)
        ) {
            shroud.consume(50);
        }
    }

    processReaversExecutioner(skill: RPRSkillName) {
        const reavers = this.resources.get(ResourceType.SoulReaver);
        const executioners = this.resources.get(ResourceType.Executioner);

        // Gibbet, Gallows, Guillotine
        if ([SkillName.Gibbet, SkillName.Gallows, SkillName.Guillotine].includes(skill)) {
            reavers.consume(1);
            return;
        }

        if ([SkillName.ExecutionersGallows, SkillName.ExecutionersGibbet, SkillName.ExecutionersGuillotine].includes(skill)) {
            executioners.consume(1);
        }

        // Any other action resets Soul reavers, even if it then gives more
        reavers.consume(reavers.availableAmount());
        executioners.consume(executioners.availableAmount());

        // Unveiled actions
        if ([SkillName.BloodStalk, SkillName.UnveiledGallows, SkillName.UnveiledGibbet, SkillName.GrimSwathe].includes(skill)) {
            this.setTimedResource(ResourceType.SoulReaver, 1);
            return;
        }

        // Pre-96 gluttony
        if (skill === SkillName.Gluttony) {
            if (Traits.hasUnlocked(TraitName.EnhancedGluttony, this.config.level)) {
                console.log("GLUTTONY");
                this.setTimedResource(ResourceType.Executioner, 2);
                return;
            }

            this.setTimedResource(ResourceType.SoulReaver, 2);
            return;
        }
    }

    processGibbetGallows(skill: SkillName) {
        const soulReavers = this.resources.get(ResourceType.SoulReaver);
        const executioners = this.resources.get(ResourceType.Executioner);

        if (!
            ([
                SkillName.Gibbet,
                SkillName.Gallows,
                SkillName.ExecutionersGibbet,
                SkillName.ExecutionersGallows
            ] as SkillName[]).includes(skill)) {

            soulReavers.consume(soulReavers.availableAmount());
            executioners.consume(executioners.availableAmount());
        }
        const matchingBuffs = new Map<SkillName, ResourceType>(
            [
                [SkillName.Gibbet, ResourceType.EnhancedGibbet],
                [SkillName.ExecutionersGibbet, ResourceType.EnhancedGibbet],
                [SkillName.Gallows, ResourceType.EnhancedGallows],
                [SkillName.ExecutionersGallows, ResourceType.EnhancedGallows],
            ]
        );
        const otherBuffs = new Map<SkillName, ResourceType>(
            [
                [SkillName.Gibbet, ResourceType.EnhancedGallows],
                [SkillName.ExecutionersGibbet, ResourceType.EnhancedGallows],
                [SkillName.Gallows, ResourceType.EnhancedGibbet],
                [SkillName.ExecutionersGallows, ResourceType.EnhancedGibbet],
            ]
        );

        //Already verified that map lookup will be successful.
        const matchingBuff = this.resources.get(matchingBuffs.get(skill) as ResourceType);
        const otherBuff = this.resources.get(otherBuffs.get(skill) as ResourceType);

        matchingBuff.consume(matchingBuff.availableAmount());
        otherBuff.consume(otherBuff.availableAmount());
        otherBuff.gain(1);
    }
}

const enshroudSkills = new Set<SkillName> (
    [
        SkillName.ShadowOfDeath,
        SkillName.WhorlOfDeath,

        SkillName.HarvestMoon,
        SkillName.Harpe,

        SkillName.VoidReaping,
        SkillName.CrossReaping,
        SkillName.GrimReaping,
        SkillName.LemuresSlice,
        SkillName.LemuresScythe,
        SkillName.Sacrificium,
        SkillName.Communio,

        SkillName.ArcaneCircle,
        SkillName.HellsIngress,
        SkillName.HellsIngress,
        SkillName.ArcaneCrest,

        SkillName.Feint,
        SkillName.LegSweep,
        SkillName.Bloodbath,
        SkillName.TrueNorth,
        SkillName.ArmsLength,
        SkillName.SecondWind,
        SkillName.Sprint,
    ]
);

const gibgalHighlightPredicate: (enhancedRsc: ResourceType) => StatePredicate<RPRState>
= (enhancedRsc) => (state: Readonly<RPRState>) => {
    const gluttonyResource = Traits.hasUnlocked(TraitName.EnhancedGluttony, state.config.level) ?
                            state.resources.get(ResourceType.Executioner)
                            : state.resources.get(ResourceType.SoulReaver);


    return state.resources.get(enhancedRsc).available(1)
                    || gluttonyResource.available(2)
}

const reaverPredicate: StatePredicate<RPRState> = (state) => state.hasResourceAvailable(ResourceType.SoulReaver);
const soulSpendPredicate: (cost: number) => StatePredicate<RPRState> = (cost) => (state) => state.resources.get(ResourceType.Soul).availableAmount() >= cost;
const isEnshroudSkill = (skill: SkillName) => enshroudSkills.has(skill);

const baseOnConfirm = (name: RPRSkillName): EffectFn<RPRState> => {
    return combineEffects(
        (state) => state.processCombo(name),
        (state) => state.processSoulGauge(name),
        (state) => state.processShroudGauge(name),
        (state) => state.processReaversExecutioner(name),
    )
} 

const basePotencyModifiers = (state: Readonly<RPRState>): PotencyModifier[] => {
    const mods: PotencyModifier[] = [];

    if (state.hasResourceAvailable(ResourceType.ArcaneCircle)) {
        mods.push(Modifiers.ArcaneCircle);
    }

    if (state.hasResourceAvailable(ResourceType.DeathsDesign)) {
        mods.push(Modifiers.DeathsDesign);
    }

    return mods
}

const makeRPRWeaponskill = (name: RPRSkillName, unlockLevel: number, params: {
    replaceIf: ConditionalSkillReplace<RPRState>[],
    startOnHotbar?: boolean,
    potency: number | Array<[TraitName, number]>,
    combo?: {
        potency: number | Array<[TraitName, number]>,
        resource: ResourceType,
        resourceValue: number,
    },
    positional?: {
        potency: number | Array<[TraitName, number]>,
        location: "flank" | "rear",
    }
    secondaryCooldown?: CooldownGroupProperies,
    aspect: Aspect,
    recastTime: number,
    applicationDelay: number,
    validateAttempt?: StatePredicate<RPRState>,
    onConfirm?: EffectFn<RPRState>,
    highlightIf: StatePredicate<RPRState>,
}): Weaponskill<RPRState> => {

    const onConfirm: EffectFn<RPRState> = combineEffects(
        baseOnConfirm(name),
        params.onConfirm ?? NO_EFFECT,
    )

    const validateAttempt: StatePredicate<RPRState> = combinePredicatesAnd(
        (state) => (!state.resources.get(ResourceType.Enshrouded).available(1) || isEnshroudSkill(name)),
        params.validateAttempt ?? (() => true)
    )
    return makeWeaponskill(ShellJob.RPR, name, unlockLevel, {
        ...params,
        onConfirm: onConfirm,
        jobPotencyModifiers: (state) => {
            const mods: PotencyModifier[] = basePotencyModifiers(state);
            if (params.combo && state.resources.get(params.combo.resource).availableAmount() === params.combo.resourceValue) {
                mods.push(
                    makeComboModifier(getBasePotency(state, params.combo.potency) - getBasePotency(state, params.potency))
                );
            }

            if (params.positional
                && (state.hasResourceAvailable(ResourceType.TrueNorth)
                    || (params.positional.location === "flank" && state.hasResourceAvailable(ResourceType.FlankPositional))
                    || (params.positional.location === "rear" && state.hasResourceAvailable(ResourceType.RearPositional)))
            ) {
                mods.push(makePositionalModifier(getBasePotency(state, params.positional.potency) - getBasePotency(state, params.potency)));
            }
            return mods;
        },
        validateAttempt: validateAttempt,
        isInstantFn: (state) => !(
            (name === SkillName.Communio)
            || (name === SkillName.Harpe && !state.hasResourceAvailable(ResourceType.EnhancedHarpe))
        ),
    })
}

const makeRPRAbility = (name: RPRSkillName, unlockLevel: number, cdName: ResourceType, params: {
    isPhysical?: boolean,
    potency?: number | Array<[TraitName, number]>,
    replaceIf?: ConditionalSkillReplace<RPRState>[],
    highlightIf?: StatePredicate<RPRState>,
    startOnHotbar?: boolean,
    applicationDelay?: number,
    cooldown: number,
    maxCharges?: number,
    validateAttempt?: StatePredicate<RPRState>,
    onConfirm?: EffectFn<RPRState>,
    onApplication?: EffectFn<RPRState>,
}): Ability<RPRState> => { 

    const onConfirm = combineEffects(
        baseOnConfirm(name),
        params.onConfirm ?? NO_EFFECT,
    );

    const validateAttempt: StatePredicate<RPRState> = combinePredicatesAnd(
        (state) => (!state.resources.get(ResourceType.Enshrouded).available(1) || isEnshroudSkill(name)),
        params.validateAttempt ?? (() => true)
    );

    return makeAbility(ShellJob.RPR, name, unlockLevel, cdName, {
        ...params,
        onConfirm: onConfirm,
        validateAttempt: validateAttempt,
        jobPotencyModifiers: (state) => {
            const mods = basePotencyModifiers(state);
            return mods
        },
    });
}

makeRPRWeaponskill(SkillName.Slice, 1, {
    replaceIf: [],
    potency: [
        [TraitName.Never, 260],
        [TraitName.MeleeMasteryII, 320],
        [TraitName.MeleeMasteryIII, 460]
    ],
    aspect: Aspect.Physical,
    recastTime: 2.5,
    applicationDelay: 0.49,
    highlightIf: (_state: Readonly<RPRState>) => false,
})

makeRPRWeaponskill(SkillName.WaxingSlice, 5, {
    replaceIf: [],
    potency: [
        [TraitName.Never, 100],
        [TraitName.MeleeMasteryII, 160],
        [TraitName.MeleeMasteryIII, 260]
    ],
    combo: {
        potency: [
            [TraitName.Never, 340],
            [TraitName.MeleeMasteryII, 400],
            [TraitName.MeleeMasteryIII, 500],
        ],
        resource: ResourceType.RPRCombo,
        resourceValue: 1,
    },
    aspect: Aspect.Physical,
    recastTime: 2.5,
    applicationDelay: 0.58,
    highlightIf: function (state: Readonly<RPRState>): boolean {
        return state.resources.get(ResourceType.RPRCombo).availableAmount() === 1;
    }
})

makeRPRWeaponskill(SkillName.InfernalSlice, 30, {
    replaceIf: [],
    potency: [
        [TraitName.Never, 100],
        [TraitName.MeleeMasteryII, 180],
        [TraitName.MeleeMasteryIII, 280],
    ],
    combo: {
        potency: [
            [TraitName.Never, 420],
            [TraitName.MeleeMasteryII, 500],
            [TraitName.MeleeMasteryIII, 600],
        ],
        resource: ResourceType.RPRCombo,
        resourceValue: 2,
    },
    aspect: Aspect.Physical,
    recastTime: 2.5,
    applicationDelay: 0.54,
    highlightIf: function (state: Readonly<RPRState>): boolean {
        return state.resources.get(ResourceType.RPRCombo).availableAmount() === 2;
    }
})

makeRPRWeaponskill(SkillName.ShadowOfDeath, 10, {
    replaceIf: [],
    potency: 300,
    aspect: Aspect.Physical,
    recastTime: 2.5,
    applicationDelay: 1.15,
    highlightIf: (_state) => false,
    onConfirm: (state) => state.refreshDeathsDesign(),
})

makeRPRWeaponskill(SkillName.SoulSlice, 60, {
    replaceIf: [],
    potency: [
        [TraitName.Never, 460],
        [TraitName.MeleeMasteryIII, 520]
    ],
    aspect: Aspect.Physical,
    recastTime: 2.5,
    applicationDelay: 0.99,
    highlightIf: (_state) => false,
    secondaryCooldown: {
        cdName: ResourceType.cd_SoulSlice,
        cooldown: 30,
        maxCharges: 2,
    }
})

makeRPRWeaponskill(SkillName.Gibbet, 70, {
    replaceIf: [],
    potency: [
        [TraitName.Never, 460],
        [TraitName.MeleeMasteryIII, 500],
    ],
    positional: {
        potency: [
            [TraitName.Never, 520],
            [TraitName.MeleeMasteryIII, 560],
        ],
        location: "flank"
    },
    aspect: Aspect.Physical,
    recastTime: 2.5,
    applicationDelay: 0.5,
    highlightIf: gibgalHighlightPredicate(ResourceType.EnhancedGibbet),
    validateAttempt: reaverPredicate,
    onConfirm: (state) => {
        state.resources.get(ResourceType.EnhancedGibbet).consume(1);
        state.setTimedResource(ResourceType.EnhancedGallows, 1);
    }
});

makeRPRWeaponskill(SkillName.Gallows, 70, {
    replaceIf: [],
    potency: [
        [TraitName.Never, 460],
        [TraitName.MeleeMasteryIII, 500],
    ],
    positional: {
        potency: [
            [TraitName.Never, 520],
            [TraitName.MeleeMasteryIII, 560],
        ],
        location: "rear"
    },
    aspect: Aspect.Physical,
    recastTime: 2.5,
    applicationDelay: 0.53,
    highlightIf: gibgalHighlightPredicate(ResourceType.EnhancedGallows),
    validateAttempt: reaverPredicate,
    onConfirm: (state) => {
        state.resources.get(ResourceType.EnhancedGallows).consume(1);
        state.setTimedResource(ResourceType.EnhancedGibbet, 1);
    }
})

makeRPRAbility(SkillName.Gluttony, 76, ResourceType.cd_Gluttony, {
    isPhysical: false,
    potency: 520,
    startOnHotbar: true,
    applicationDelay: 1.06,
    cooldown: 60,
    validateAttempt: soulSpendPredicate(50),
    onApplication: (state) => {
        //console.log(state.resources.get(ResourceType.Executioner));
    }
});

makeResourceAbility(ShellJob.RPR, SkillName.ArcaneCircle, 72, ResourceType.cd_ArcaneCircle, {
    rscType: ResourceType.ArcaneCircle,
    applicationDelay: 0.64,
    startOnHotbar: true,
    maxCharges: 1,
    potency: 0,
    onApplication: (state: RPRState) => {
        console.log("AC");
        state.setTimedResource(ResourceType.CircleOfSacrifice, 1);
        state.setTimedResource(ResourceType.BloodsownCircle, 1);
    },
    cooldown: 120,
    validateAttempt: (state) => true,
});

makeRPRAbility(SkillName.ArcaneCircle, 76, ResourceType.cd_ArcaneCircle, {
    isPhysical: false,
    startOnHotbar: true,
    cooldown: 0
})