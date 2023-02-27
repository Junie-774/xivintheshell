import React, {CSSProperties} from 'react'
import {controller} from "../Controller/Controller";
// @ts-ignore
import {skillIcons} from "./Skills";
import {Clickable} from "./Common";
import {Tooltip as ReactTooltip} from 'react-tooltip';
import {ActionNode} from "../Controller/Record";
import {ResourceType, SkillName} from "../Game/Common";
import {localizeSkillName} from "./Localization";

const MAX_HEIGHT = 400;
export function Cursor(props: {
	vOffset: number;
	elem: {
		time: number;
		displayTime: number;
	};
	elemID: string;
	color: string;
}) {
	let style={
		width: 6,
		height: MAX_HEIGHT,
		top: props.vOffset,
		left: controller.timeline.positionFromTime(props.elem.time) - 3,
		zIndex: 2,
	};
	return <div style={style} className={"timeline-elem cursor"} data-tip data-for={`${props.elemID}`}>
		{/*
		<svg width={6} height={MAX_HEIGHT}>
			<line x1="3" y1="0" x2="3" y2={`${MAX_HEIGHT}`} stroke={props.color}/>
			<polygon points="0,0 6,0 3,6" fill={props.color} stroke="none"/>
		</svg>*/}
		<ReactTooltip id={`${props.elemID}`}>{props.elem.displayTime.toFixed(2)}</ReactTooltip>
	</div>;
}

export let MPTickMark = React.memo(function(props: {
	vOffset: number;
	positionFromTime: number;
	elem: {
		displayTime: number;
		source: string
	};
	elemID: string;
}) {
	let style : CSSProperties = {
		position: "absolute",
		top: props.vOffset,
		left: props.positionFromTime - 2,
		width: 4,
		height: MAX_HEIGHT,
	};
	return <div style={style} className={"timeline-elem MPTickMark"} data-tip data-for={`${props.elemID}`}>
		<ReactTooltip id={`${props.elemID}`}>
			<span>[{props.elem.displayTime.toFixed(2)}] {props.elem.source}</span>
		</ReactTooltip>
	</div>;
});

export let DamageMark = React.memo(function(props: {
	positionFromTime: number;
	vOffset: number,
	elem: {
		displayTime: number,
		potency: number,
		source: string,
		buffs: ResourceType[]
	},
	tincturePotencyMultiplier: number,
	elemID: string;
}) {
	let style={
		top: props.vOffset,
		left: props.positionFromTime - 3,
		width: 6,
		height: 6,
		zIndex: 1
	};
	// pot?
	let pot = false;
	props.elem.buffs.forEach(b=>{
		if (b===ResourceType.Tincture) pot = true;
	});
	// potency
	let potency = props.elem.potency;
	if (pot) potency *= props.tincturePotencyMultiplier;
	// hover text
	let hoverText = "[" + props.elem.displayTime.toFixed(2) + "] " + potency.toFixed(2) + " (" + props.elem.source + ")";
	if (pot) hoverText += " (pot)"
	return <div style={style} className={"timeline-elem damageMark"} data-tip data-for={`${props.elemID}`}>
		<ReactTooltip id={`${props.elemID}`}>{hoverText}</ReactTooltip>
	</div>;
});

export let LucidMark = React.memo(function(props: {
	positionFromTime: number;
	vOffset: number;
	elem: {
		displayTime: number;
		source: string;
	};
	elemID: string;
}) {
	let style={
		top: props.vOffset,
		left: props.positionFromTime - 3,
		zIndex: 1
	};
	return <div style={style} className={"timeline-elem lucidMark"} data-tip data-for={`${props.elemID}`}>
		<svg width={6} height={6}>
			<polygon points="0,0 6,0 3,6" fill="#88cae0" stroke="none"/>
		</svg>
		<ReactTooltip id={`${props.elemID}`}>[{props.elem.displayTime.toFixed(2)}] {props.elem.source}</ReactTooltip>
	</div>;
});

export let bHandledSkillSelectionThisFrame : boolean = false;
export function setHandledSkillSelectionThisFrame(handled : boolean) {
	bHandledSkillSelectionThisFrame = handled;
}
let TimelineSkillStaticPart = React.memo(function(props:{
	lockBarWidth: number,
	isSpellCast: boolean,
	isGCD: boolean,
	recastBarWidth: number,
	snapshotRelativePositionX: number
}){
	let lockBarStyle: CSSProperties = {
		position: "absolute",
		top: 0,
		background: props.isSpellCast ? "#e7d9ee" : "#9d9d9d",
		width: props.lockBarWidth,
		height: props.isSpellCast ? 14 : 28,
		zIndex: 1
	};
	let lockBar = <div style={lockBarStyle}/>
	let recastBarStyle: CSSProperties = {
		position: "absolute",
		top: 14,
		background: "#dbf3d6",
		width: props.recastBarWidth,
		height: 14,
		zIndex: 1
	};
	let recastBar = <div style={recastBarStyle}/>
	let snapshotIndicatorStyle: CSSProperties = {
		position: "absolute",
		width: 0,
		height: 14,
		top: 0,
		left: props.snapshotRelativePositionX,
		borderLeft: "1px solid " + "rgba(151,85,239,0.2)",
		zIndex: 1
	}
	let snapshotIndicator = <div style={snapshotIndicatorStyle}/>

	return <div>
		{lockBar}
		{props.isGCD ? recastBar : <div/>}
		{snapshotIndicator}
	</div>
});

export function TimelineSkill(props: {
	elem: {
		node: ActionNode;
		lockDuration: number;
		isSpellCast: boolean;
		recastDuration: number;
		relativeSnapshotTime: number;
		skillName: SkillName;
		displayTime: number;
		time: number;
		isGCD: boolean;
	};
	tincturePotencyMultiplier: number;
	elemID: string;
}) {
	let node = props.elem.node;

	let iconStyle: CSSProperties = {
		position: "absolute",
		top: 0,
		width: 28,
		height: 28,
		outline: "none",
		zIndex: 1,
	};
	let description = localizeSkillName(props.elem.skillName) + "@" + (props.elem.displayTime).toFixed(2);
	if (node.hasBuff(ResourceType.LeyLines)) description += " (LL)";
	if (node.hasBuff(ResourceType.Tincture)) description += " (pot)";
	let hoverText = <span>{description}</span>;
	let componentStyle={
		left: controller.timeline.positionFromTime(props.elem.time),
		top: props.elem.isGCD ? 14 : 0,
	};
	let lockDuration = 0;
	if (node.tmp_endLockTime!==undefined && node.tmp_startLockTime!==undefined) {
		lockDuration = node.tmp_endLockTime - node.tmp_startLockTime;
	}
	let potency = node.getPotency();
	if (potency > 0) {
		if (node.hasBuff(ResourceType.Tincture))  {
			potency *= props.tincturePotencyMultiplier;
		}
		hoverText = <div>
			{hoverText}<br/>
			<span>{"potency: " + potency.toFixed(2)}</span><br/>
			<span>{"duration: " + lockDuration.toFixed(2)}</span>
		</div>;
	}
	let iconImg = <div style={iconStyle} tabIndex={0} className={"timeline-elem-skill-icon"} onKeyDown={e => {
		if (e.key === "Backspace" || e.key === "Delete") {
			controller.rewindUntilBefore(controller.record.getFirstSelection(), false);
			controller.displayCurrentState();
			controller.updateAllDisplay();
			controller.autoSave();
		}
	}}>
	</div>;
	return <div style={componentStyle} className={"timeline-elem skill"} data-tip data-for={`${props.elemID}`}>
		<Clickable key={node.getNodeIndex()} content={iconImg} onClickFn={(e) => {
			bHandledSkillSelectionThisFrame = true;
			controller.timeline.onClickTimelineAction(node, e.shiftKey);
		}}/>
		<ReactTooltip id={`${props.elemID}`}>{hoverText}</ReactTooltip>
	</div>;
}