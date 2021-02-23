/**
 * Example random player AI.
 *
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * @license MIT
 */

import {ObjectReadWriteStream} from '../../lib/streams';
import {BattlePlayer} from '../battle-stream';
import {PRNG, PRNGSeed} from '../prng';
import {sendEmbed} from '../../../src/modules/utils';
import MessageEmbed from '../../../src/modules/MessageEmbed';
import {MessageCollector} from 'eris-collector';
import {Client, Message, TextableChannel} from 'eris';

export class DiscordPlayer extends BattlePlayer {
	protected readonly move: number;
	protected readonly mega: number;
	protected readonly prng: PRNG;
	protected readonly context: {client: Client, channel: TextableChannel, userID: string};
	canPickMove: boolean;
	mustSwitch: boolean;
	wantSwitch: boolean;
	active: any = null;
	side: any = null;
	collector: any;
	lastRequest: any = null;

	constructor(
		playerStream: ObjectReadWriteStream<string>,
		options: {move?: number, mega?: number, seed?: PRNG | PRNGSeed | null} = {},
		debug = false,
		context: {client: Client, channel: TextableChannel, userID: string}
	) {
		super(playerStream, debug);
		this.move = options.move || 1.0;
		this.mega = options.mega || 0;
		this.prng = options.seed && !Array.isArray(options.seed) ? options.seed : new PRNG(options.seed);
		this.context = context;

		this.canPickMove = false;
		this.mustSwitch = false;
		this.wantSwitch = false;

		const filter = (m: Message) => m.author.id === context.userID;
		this.collector = new MessageCollector(context.client, context.channel, filter);

		this.collector.on('collect', (m: Message) => {
			const message = m.content.toLowerCase();
			if (this.canPickMove) {
				if (message === 'switch') {
					this.wantSwitch = true;
					this.canPickMove = false;
					this.requestActions();
				} else {
					let choice: any = parseInt(message);
					if (choice >= 1 || choice <= 4) {
						if (this.active.moves[choice - 1] === undefined) {
							void sendEmbed(context, context.channel, `Your Pokémon doesn't have a move ${choice}`);
						} else if (this.active.moves[choice - 1].disabled) {
							void sendEmbed(context, context.channel, `You can't use ${this.active.moves[choice - 1].name} because it is disabled`);
						} else {
							void sendEmbed(context, context.channel, `Waiting for you opponent.`);
							this.choose(`move ${choice}`);
							this.canPickMove = false;
						}
					}
				}
			} else if (this.mustSwitch) {
				const choice = parseInt(message);
				if (choice >= 1 || choice <= 3) {
					if (this.side.pokemon[choice - 1] === undefined) {
						void sendEmbed(context, context.channel, `You don't have a Pokémon in your slot ${choice}`);
					} else if (choice === 1) {
						void sendEmbed(context, context.channel, `You must send an other Pokémon to fight`);
					} else if (this.side.pokemon[choice - 1].condition.includes('fnt')) {
						void sendEmbed(context, context.channel, `You can't send a fainted Pokémon`);
					} else {
						this.choose(`switch ${choice}`);
						this.mustSwitch = false;
					}
				}
			} else if (this.wantSwitch) {
				if (message === 'move' || message === 'moves') {
					this.wantSwitch = false;
					this.canPickMove = true;
					this.requestActions();
				} else {
					const choice = parseInt(message);
					if (choice >= 1 || choice <= 3) {
						if (this.side.pokemon[choice - 1] === undefined) {
							void sendEmbed(context, context.channel, `You don't have a Pokémon in your slot ${choice}`);
						} else if (choice === 1) {
							void sendEmbed(context, context.channel, `You must send an other Pokémon to fight`);
						} else {
							void sendEmbed(context, context.channel, `Waiting for you opponent.`);
							this.choose(`switch ${choice}`);
							this.mustSwitch = false;
						}
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
			const moves = this.active.moves;

			const embed = new MessageEmbed();
			embed.addField('Move #1', moves[0] !== undefined ? `${moves[0].move}\n${moves[0].disabled ? `Disabled` : `${moves[0].pp}/${moves[0].maxpp}`}` : `\u2800`, true);
			embed.addField('Move #2', moves[1] !== undefined ? `${moves[1].move}\n${moves[1].disabled ? `Disabled` : `${moves[1].pp}/${moves[1].maxpp}`}` : `\u2800`, true);
			embed.addField('\u2800', '\u2800', true);
			embed.addField('Move #3', moves[2] !== undefined ? `${moves[2].move}\n${moves[2].disabled ? `Disabled` : `${moves[2].pp}/${moves[2].maxpp}`}` : `\u2800`, true);
			embed.addField('Move #4', moves[3] !== undefined ? `${moves[3].move}\n${moves[3].disabled ? `Disabled` : `${moves[3].pp}/${moves[3].maxpp}`}` : `\u2800`, true);
			embed.addField('\u2800', '\u2800', true);

			embed.setFooter(`Select move by sending 1, 2, 3 or 4. Send switch to switch Pokémon`);

			void this.context.channel.createMessage(embed);
		} else if (this.mustSwitch || this.wantSwitch) {
			const pokemons = this.side.pokemon;

			const embed = new MessageEmbed();
			embed.addField('Pokemon #1', pokemons[0] !== undefined ? `${pokemons[0].ident.replace(/(p1: |p2: )/, '').split(';')[0]}\nUnavailable` : `\u2800`, true);
			embed.addField('Pokemon #2', pokemons[1] !== undefined ? `${pokemons[1].ident.replace(/(p1: |p2: )/, '').split(';')[0]}\n${pokemons[1].condition}` : `\u2800`, true);
			embed.addField('Pokemon #3', pokemons[2] !== undefined ? `${pokemons[2].ident.replace(/(p1: |p2: )/, '').split(';')[0]}\n${pokemons[2].condition}` : `\u2800`, true);

			embed.setFooter(`Select Pokémon to send by sending 1, 2 or 3. Send moves to use a move`);

			void this.context.channel.createMessage(embed);
		}
	}

	receiveError(error: Error) {
		// If we made an unavailable choice we will receive a followup request to
		// allow us the opportunity to correct our decision.
		this.receiveRequest(this.lastRequest);
		this.requestActions();
		// if (error.message.startsWith('[Unavailable choice]')) return;
		// throw error;
	}

	receiveRequest(request: AnyObject) {
		console.log(request);
		this.lastRequest = request;
		if (request.wait) {
			// wait request
			// do nothing
		} else if (request.forceSwitch) {
			this.mustSwitch = true;
			this.requestActions();
		} else if (request.active) {
			this.canPickMove = true;
			this.side = request.side;
			this.active = request.active[0];
			// this.choose(choices.join(`, `));
		} else {
			// team preview?
			this.choose(this.chooseTeamPreview(request.side.pokemon));
		}
	}

	protected chooseTeamPreview(team: AnyObject[]): string {
		return `default`;
	}

	protected chooseMove(active: AnyObject, moves: {choice: string, move: AnyObject}[]): string {
		return this.prng.sample(moves).choice;
	}

	protected chooseSwitch(active: AnyObject | undefined, switches: {slot: number, pokemon: AnyObject}[]): number {
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
