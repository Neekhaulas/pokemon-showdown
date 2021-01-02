/**
 * Example random player AI.
 *
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * @license MIT
 */

import { ObjectReadWriteStream } from '../../lib/streams';
import { BattlePlayer } from '../battle-stream';
import { PRNG, PRNGSeed } from '../prng';
import { CommandContext } from '../../../src/types/command';
import { sendEmbed } from '../../../src/modules/utils';
import MessageEmbed from '../../../src/modules/MessageEmbed';
import MessageCollector from 'eris-collector';
import { Message } from 'eris';

export class DiscordPlayer extends BattlePlayer {
	protected readonly move: number;
	protected readonly mega: number;
	protected readonly prng: PRNG;
	protected readonly context: CommandContext;
	canPickMove: boolean;
	mustSwitch: boolean;
	active: any = null;
	side: any = null;
	collector: any;

	constructor(
		playerStream: ObjectReadWriteStream<string>,
		options: { move?: number, mega?: number, seed?: PRNG | PRNGSeed | null } = {},
		debug = false,
		context: CommandContext
	) {
		super(playerStream, debug);
		this.move = options.move || 1.0;
		this.mega = options.mega || 0;
		this.prng = options.seed && !Array.isArray(options.seed) ? options.seed : new PRNG(options.seed);
		this.context = context;

		this.canPickMove = false;
		this.mustSwitch = false;

		const filter = (m: Message) => m.author.id === context.message.author.id;
		this.collector = new MessageCollector(context.client.discordClient, context.channel, filter);

		this.collector.on('collect', (m: Message) => {
			if (this.canPickMove) {
				var choice = parseInt(m.content);
				if (choice >= 1 || choice <= 4) {
					if(this.active.moves[choice - 1] == undefined) {
						sendEmbed(context, context.channel, `Your Pokémon doesn't have a move ${choice}`);
					} else if (this.active.moves[choice - 1].disabled) {
						sendEmbed(context, context.channel, `You can't use ${this.active.moves[choice - 1]} because it is disabled`);
					} else {
						this.choose(`move ${choice}`);
						this.canPickMove = false;
					}
				}
			} else if (this.mustSwitch) {
				var choice = parseInt(m.content);
				if (choice >= 1 || choice <= 3) {
					if (this.side.pokemon[choice - 1] == undefined) {
						sendEmbed(context, context.channel, `You don't have a Pokémon in your slot ${choice}`);
					} else if(choice == 1) {
						sendEmbed(context, context.channel, `You must send an other Pokémon to fight`);
					} else {
						this.choose(`switch ${choice}`);
						this.mustSwitch = false;
					}
				}
			}
		});
	}

	kill() {
		this.collector.stop();
	}

	requestActions() {
		if (this.canPickMove) {
			var moves = this.active.moves;

			var embed = new MessageEmbed();
			embed.addField('Move #1', moves[0] != undefined ? `${moves[0].move}\n${moves[0].disabled ? `Disabled` : `${moves[0].pp}/${moves[0].maxpp}`}` : `\u2800`, true);
			embed.addField('Move #2', moves[1] != undefined ? `${moves[1].move}\n${moves[1].disabled ? `Disabled` : `${moves[1].pp}/${moves[1].maxpp}`}` : `\u2800`, true);
			embed.addField('\u2800', '\u2800', true);
			embed.addField('Move #3', moves[2] != undefined ? `${moves[2].move}\n${moves[2].disabled ? `Disabled` : `${moves[2].pp}/${moves[2].maxpp}`}` : `\u2800`, true);
			embed.addField('Move #4', moves[3] != undefined ? `${moves[3].move}\n${moves[3].disabled ? `Disabled` : `${moves[3].pp}/${moves[3].maxpp}`}` : `\u2800`, true);
			embed.addField('\u2800', '\u2800', true);

			embed.setFooter(`Select move by sending 1, 2, 3 or 4`);

			this.context.channel.createMessage(embed);
		} else if (this.mustSwitch) {
			var pokemons = this.side.pokemon;
			console.log(pokemons);

			var embed = new MessageEmbed();
			embed.addField('Pokemon #1', pokemons[0] != undefined ? `${pokemons[0].ident.replace(/(p1: |p2: )/, '')}\nUnavailable` : `\u2800`, true);
			embed.addField('Pokemon #2', pokemons[1] != undefined ? `${pokemons[1].ident.replace(/(p1: |p2: )/, '')}\n${pokemons[1].condition}` : `\u2800`, true);
			embed.addField('Pokemon #3', pokemons[2] != undefined ? `${pokemons[2].ident.replace(/(p1: |p2: )/, '')}\n${pokemons[2].condition}` : `\u2800`, true);

			embed.setFooter(`Select Pokémon to send by sending 1, 2 or 3`);

			this.context.channel.createMessage(embed);
		}
	}

	receiveError(error: Error) {
		// If we made an unavailable choice we will receive a followup request to
		// allow us the opportunity to correct our decision.
		this.canPickMove = false;
		console.log(error);
		if (error.message.startsWith('[Unavailable choice]')) return;
		throw error;
	}

	receiveRequest(request: AnyObject) {
		console.log('Request', request);
		if (request.wait) {
			console.log('Wait');
			// wait request
			// do nothing
		} else if (request.forceSwitch) {
			console.log('Waiting for switch');
			this.mustSwitch = true;
			// switch request
			const pokemon = request.side.pokemon;
			const chosen: number[] = [];
			const choices = request.forceSwitch.map((mustSwitch: AnyObject) => {
				console.log("Must switch", mustSwitch);
				if (!mustSwitch) return `pass`;


				const canSwitch = range(1, 6).filter(i => (
					pokemon[i - 1] &&
					// not active
					i > request.forceSwitch.length &&
					// not chosen for a simultaneous switch
					!chosen.includes(i) &&
					// not fainted
					!pokemon[i - 1].condition.endsWith(` fnt`)
				));

				if (!canSwitch.length) return `pass`;
				const target = this.chooseSwitch(
					request.active,
					canSwitch.map(slot => ({ slot, pokemon: pokemon[slot - 1] }))
				);
				chosen.push(target);
				return `switch ${target}`;
			});

			//this.choose(`switch 1`);
		} else if (request.active) {
			console.log('Select move');
			this.canPickMove = true;
			this.side = request.side;
			this.active = request.active[0];
			// move request
			let [canMegaEvo, canUltraBurst, canZMove, canDynamax] = [true, true, true, true];
			const pokemon = request.side.pokemon;
			const chosen: number[] = [];
			const choices = request.active.map((active: AnyObject, i: number) => {
				if (pokemon[i].condition.endsWith(` fnt`)) return `pass`;

				this.active = active;

				canMegaEvo = canMegaEvo && active.canMegaEvo;
				canUltraBurst = canUltraBurst && active.canUltraBurst;
				canZMove = canZMove && !!active.canZMove;
				canDynamax = canDynamax && !!active.canDynamax;

				// Determine whether we should change form if we do end up switching
				const change = (canMegaEvo || canUltraBurst || canDynamax) && this.prng.next() < this.mega;
				// If we've already dynamaxed or if we're planning on potentially dynamaxing
				// we need to use the maxMoves instead of our regular moves

				const useMaxMoves = (!active.canDynamax && active.maxMoves) || (change && canDynamax);
				const possibleMoves = useMaxMoves ? active.maxMoves.maxMoves : active.moves;

				let canMove = range(1, possibleMoves.length).filter(j => (
					// not disabled
					!possibleMoves[j - 1].disabled
					// NOTE: we don't actually check for whether we have PP or not because the
					// simulator will mark the move as disabled if there is zero PP and there are
					// situations where we actually need to use a move with 0 PP (Gen 1 Wrap).
				)).map(j => ({
					slot: j,
					move: possibleMoves[j - 1].move,
					target: possibleMoves[j - 1].target,
					zMove: false,
				}));
				if (canZMove) {
					canMove.push(...range(1, active.canZMove.length)
						.filter(j => active.canZMove[j - 1])
						.map(j => ({
							slot: j,
							move: active.canZMove[j - 1].move,
							target: active.canZMove[j - 1].target,
							zMove: true,
						})));
				}

				// Filter out adjacentAlly moves if we have no allies left, unless they're our
				// only possible move options.
				const hasAlly = pokemon.length > 1 && !pokemon[i ^ 1].condition.endsWith(` fnt`);
				const filtered = canMove.filter(m => m.target !== `adjacentAlly` || hasAlly);
				canMove = filtered.length ? filtered : canMove;

				const moves = canMove.map(m => {
					let move = `move ${m.slot}`;
					// NOTE: We don't generate all possible targeting combinations.
					if (request.active.length > 1) {
						if ([`normal`, `any`, `adjacentFoe`].includes(m.target)) {
							move += ` ${1 + Math.floor(this.prng.next() * 2)}`;
						}
						if (m.target === `adjacentAlly`) {
							move += ` -${(i ^ 1) + 1}`;
						}
						if (m.target === `adjacentAllyOrSelf`) {
							if (hasAlly) {
								move += ` -${1 + Math.floor(this.prng.next() * 2)}`;
							} else {
								move += ` -${i + 1}`;
							}
						}
					}
					if (m.zMove) move += ` zmove`;
					return { choice: move, move: m };
				});

				const canSwitch = range(1, 6).filter(j => (
					pokemon[j - 1] &&
					// not active
					!pokemon[j - 1].active &&
					// not chosen for a simultaneous switch
					!chosen.includes(j) &&
					// not fainted
					!pokemon[j - 1].condition.endsWith(` fnt`)
				));
				const switches = active.trapped ? [] : canSwitch;

				if (switches.length && (!moves.length || this.prng.next() > this.move)) {
					const target = this.chooseSwitch(
						active,
						canSwitch.map(slot => ({ slot, pokemon: pokemon[slot - 1] }))
					);
					chosen.push(target);
					return `switch ${target}`;
				} else if (moves.length) {
					const move = this.chooseMove(active, moves);
					if (move.endsWith(` zmove`)) {
						canZMove = false;
						return move;
					} else if (change) {
						if (canDynamax) {
							canDynamax = false;
							return `${move} dynamax`;
						} else if (canMegaEvo) {
							canMegaEvo = false;
							return `${move} mega`;
						} else {
							canUltraBurst = false;
							return `${move} ultra`;
						}
					} else {
						return move;
					}
				} else {
					throw new Error(`${this.constructor.name} unable to make choice ${i}. request='${request}',` +
						` chosen='${chosen}', (mega=${canMegaEvo}, ultra=${canUltraBurst}, zmove=${canZMove},` +
						` dynamax='${canDynamax}')`);
				}
			});
			//this.choose(choices.join(`, `));
		} else {
			console.log('Preview');
			// team preview?
			this.choose(this.chooseTeamPreview(request.side.pokemon));
		}
	}

	protected chooseTeamPreview(team: AnyObject[]): string {
		console.log('Choose team preview', team);
		return `default`;
	}

	protected chooseMove(active: AnyObject, moves: { choice: string, move: AnyObject }[]): string {
		console.log('Choose move');

		return this.prng.sample(moves).choice;
	}

	protected chooseSwitch(active: AnyObject | undefined, switches: { slot: number, pokemon: AnyObject }[]): number {
		console.log('Choose switch');
		return this.prng.sample(switches).slot;
	}
}

// Creates an array of numbers progressing from start up to and including end
function range(start: number, end?: number, step = 1) {
	if (end === undefined) {
		end = start;
		start = 0;
	}
	const result = [];
	for (; start <= end; start += step) {
		result.push(start);
	}
	return result;
}
