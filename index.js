const Eris = require("eris");
const config = require("./config.json");
const fs = require("fs");
const pg = require("pg");
const msg = require("./utilities/message.js");
const user = require("./utilities/user.js");
const secret = require("./secret.json");
const Embed = require("./structures/embed.js");
const Game = require("./structures/game.js");
const pool = new pg.Pool({
  user: "postgres", //postgres role
  password: secret.dbpassword, //postgres role password
  database: "treedb" //database
});
const similarity = require("string-similarity");
class Tree {
  constructor(token) {
    this.client = new Eris(token, { getAllUsers: true });
    this.commands = new Eris.Collection();
    this.commandAliases = new Eris.Collection();
    this.pool = pool;
    this.waitingForMessage = {};
    this.games = new Eris.Collection();
  }
  async getGuildData(id, columns = "*") {
    let result = await pool.query("SELECT " + columns + " FROM guilds WHERE id = $1", [id]);
    if(!result.rows[0] && typeof id === "string" && id.length <= 20 && /^\d+$/.test(id)) {
      result = await pool.query("INSERT INTO guilds (id) VALUES ($1) RETURNING " + columns, [id]);
    }
    return result.rows[0];
  }
  async alterGuildData(id, column, value) {
    let result = await pool.query("SELECT * FROM guilds WHERE id = $1", [id]);
    if (!result.rows[0]) {
      if (typeof id === "string" && id.length <= 20 && /^\d+$/.test(id)) {
        await pool.query("INSERT INTO guilds (id) VALUES ($1)", [id]);
      }
    }
    pool.query("UPDATE guilds SET " + column + " = $1 WHERE id = $2", [value, id]);
  }
  async getGlobalUserData(id, columns = "*") {
    let result = (await pool.query("SELECT " + columns + " FROM globalusers WHERE id = $1", [id]));
    if (!result.rows[0] && typeof id === "string" && id.length <= 20 && /^\d+$/.test(id)) {
      result = await pool.query("INSERT INTO globalusers (id) VALUES ($1) RETURNING " + columns, [id]);
    }
    return result.rows[0];
  }
  async alterGlobalUserData(id, column, value) {
    let result = await pool.query("SELECT * FROM globalusers WHERE id = $1", [id]);
    if (!result.rows[0]) {
      if (typeof id === "string" && id.length <= 20 && /^\d+$/.test(id)) {
        await pool.query("INSERT INTO globalusers (id) VALUES ($1)", [id]);
      }
    }
    pool.query("UPDATE users SET " + column + " = $1 WHERE id = $2", [value, id]);
  }
  async getGuildUserData(userid, guildid, columns = "*") {
    let result = (await pool.query("SELECT " + columns + " FROM guildusers WHERE (userid, guildid) = ($1, $2)", [userid, guildid]));
    if (!result.rows[0] && typeof userid === "string" && userid.length <= 20 && /^\d+$/.test(userid) && typeof guildid === "string" && guildid.length <= 20 && /^\d+$/.test(guildid)) {
      result = await pool.query("INSERT INTO guildusers (userid, guildid) VALUES ($1, $2) RETURNING " + columns, [userid, guildid]);
    }
    return result.rows[0];
  }
  async alterGuildUserData(userid, guildid, column, value) {
    let result = await pool.query("SELECT * FROM guildusers WHERE (userid, guildid) = ($1, $2)", [userid, guildid]);
    if (!result.rows[0]) {
      if (!result.rows[0] && typeof userid === "string" && userid.length <= 20 && /^\d+$/.test(userid) && typeof guildid === "string" && guildid.length <= 20 && /^\d+$/.test(guildid)) {
        await pool.query("INSERT INTO guildusers (userid, guildid) VALUES ($1, $2)", [userid, guildid]);
      }
    }
    pool.query("UPDATE guildusers SET " + column + " = $1 WHERE (userid, guildid) = ($2, $3)", [value, userid, guildid]);
  }
  waitForMessage(user, channel, callback, command = false, info) {
    if (!/^\d+$/.test(user)) throw "Invalid user in waitForMessage!";
    if (typeof callback !== "function") throw "Invalid callback!";
    if (!/^\d+$/.test(channel)) throw "Invalid channel!"; //room for improvement: actually check for the channel
    if (!this.waitingForMessage[channel]) this.waitingForMessage[channel] = {};
    this.waitingForMessage[channel][user] = {
      callback: callback,
      command: false,
    }
    if (info) this.waitingForMessage[channel][user].info = info;
  }
  async getPrefix(guildid) {
    return (await this.getGuildData(guildid, "prefix")).prefix;
  }
}
const tree = new Tree(secret.token);
module.exports.tree = tree;

tree.client.on("ready", () => {
  fs.readdir("./Tree/commands/", (err, files) => {
    let jsFiles = files.filter(file => file.split(".").pop() === "js");
    jsFiles.forEach((file, index) => {
      let requiredFile = require(`./commands/${file}`);
      if (requiredFile.help && requiredFile.help.name && requiredFile.run) {
        tree.commands.set(requiredFile.help.name, requiredFile);
        console.log(`[${index + 1}] Successfully loaded command ${requiredFile.help.name}!`);
      }
    });
  });
  tree.client.editStatus("online", {
    name: "@Tree info for info"
  });
  setInterval(() => {
    for (let entry of tree.games) {
      let endedGames = entry[1].filter(game => game.lastUpdated + 45000 < Date.now());
      let inactiveGames = entry[1].filter(game => !game.inactive && game.lastUpdated + 30000 < Date.now());
      for (let i = 0; i < endedGames.length; i++) {
        msg.create("`" + endedGames[i].name + "` ended for inactivity.", endedGames[i].channel);
        Game.remove(endedGames[0]);
      }
      for (let i = 0; i < inactiveGames.length; i++) {
        inactiveGames[i].inactive = true;
        msg.create("`" + inactiveGames[i].name + "` is about to be ended for inactivity!", inactiveGames[i].channel);
      }
    }
  }, 5000);
});

tree.client.on("messageCreate", async message => {
  if (!message || !message.author || message.author.bot) return;
  if (!tree.games.get(message.channel.id))
    tree.games.set(message.channel.id, []);
  let games = tree.games.get(message.channel.id);
  if (games.length) { //all the game logic goes here
    let tictactoe = games.filter(game => game.name === "tic tac toe" && game.state)[0];
    if (tictactoe) { //tic tac toe logic
      if (tictactoe.players.filter(player => player.id === message.author.id)[0]) { //if the message sender is playing tic tac toe
        if (message.content.replace(/[ABC][1-3]/i, "").length === 0) {
          if (tictactoe.turn.id === message.author.id) { //if it's his turn
            tictactoe.update();
            let indexes = message.content.replace(/A/i, "1").replace(/B/i, "2").replace(/C/i, "3");
            indexes = indexes.split("").map(i => i - 1);
            if (tictactoe.grid[indexes[1]][indexes[0]] !== "_") {
              msg.create("Illegal move! There's already an `" + tictactoe.grid[indexes[1]][indexes[0]] + "` there.", message.channel);
            }else{
              await msg.delete(message);
              let grid = tictactoe.grid;
              grid[indexes[1]][indexes[0]] = tictactoe.players.filter(p => p.id === message.author.id)[0].side.toUpperCase();
              if (grid.every(row => row[0] !== "_" && row[1] !== "_" && row[2] !== "_"))
                return tictactoe.draw();
              if (grid[indexes[1]][0] !== "_" && grid[indexes[1]][0] === grid[indexes[1]][1] && grid[indexes[1]][0] === grid[indexes[1]][2])
                return tictactoe.win(grid[indexes[1]][0]);
              if (grid[0][indexes[0]] !== "_" && grid[0][indexes[0]] === grid[1][indexes[0]] && grid[0][indexes[0]] === grid[2][indexes[0]])
                return tictactoe.win(grid[0][indexes[0]]);
              if ((grid[1][1] !== "_" && grid[1][1] === grid[0][0] && grid[1][1] === grid[2][2]) || grid[1][1] !== "_" && grid[1][1] === grid[2][0] && grid[1][1] === grid[0][2])
                return tictactoe.win(grid[1][1]);
              tictactoe.send();
            }
          }else{
            msg.create("It's not your turn, " + user.discrim(message.author) + "!", message.channel);
          }
        }
      }
    }
  }
  let prefix = "";
  if (tree.waitingForMessage[message.channel.id] && tree.waitingForMessage[message.channel.id][message.author.id]) {
    tree.waitingForMessage[message.channel.id][message.author.id].callback(message, tree.waitingForMessage[message.channel.id][message.author.id].info);
    let command = tree.waitingForMessage[message.channel.id][message.author.id].command;
    tree.waitingForMessage[message.channel.id][message.author.id] = null;
    if (!command) return;
  }
  if (message.channel.guild) {
    prefix = (await tree.getGuildData(message.channel.guild.id, "prefix")).prefix;
    if (message.content.startsWith(prefix)) {
      message.content = message.content.replace(prefix, "");
    }else if (message.content.startsWith("<@363293460809121813>")) {
      message.content = message.content.replace("<@363293460809121813>", "").trim();
    }else{
      return;
    }
  }
  let args = message.content.split(/\s+/);
  let command = args.shift().toLowerCase();
  let requiredCommand = tree.commands.find(cmd => cmd.help.name.toLowerCase() === command || cmd.help.aliases.map(alias => alias.toLowerCase()).indexOf(command) >= 0);
  if (!requiredCommand) {
    if (!message.channel.guild) {
      let embed = new Embed(null, "\` " + command + "\` is not a recognized command! Type \`" + prefix + "help\` for help!");
      if (command.startsWith(prefix)) embed.addFooter("Remember that you can't put the prefix when doing a command in DMs!");
      msg.create(embed, message.channel);
    }else{
      msg.delete(message);
      msg.dm(message.author.id, "\` " + command + "\` is not a recognized command! Type \`" + prefix + "help\` for help!");
    }
    return;
  }
  if (!requiredCommand.help.channel.includes("dm") && !message.channel.guild) return message.channel.createMessage("That command can't be used in DMs!");
  if (!requiredCommand.help.channel.includes("server") && message.channel.guild) return message.channel.createMessage("That command can only be used in DMs!");
  if (requiredCommand.help.category === "unfinished" && !config.owners.includes(message.author.id)) {
    msg.delete(message);
    return msg.dm(message.author.id, "Only the owner can use unfinished commands! Don't worry, though, this command will probably be released to the public soon if it's good enough!");
  }
  if (requiredCommand.help.permission && !message.member.permission.has(requiredCommand.help.permission)) {
    msg.delete(message);
    return msg.dm(message.author.id, "You don't have have the required `" + requiredCommand.help.permission + "` permission to use the `" + requiredCommand.help.name + "` command in `" + message.channel.guild.name + "`!");
  }
  let restrictedCommands;
  if (!message.channel.type) restrictedCommands = (await tree.getGuildData(message.channel.guild.id, "disabled_commands")).disabled_commands;
  if (!message.channel.type && !message.member.permission.has("administrator") && restrictedCommands.filter(command => command.split("|")[1] === message.channel.id).map(command => command.split("|")[0]).indexOf(requiredCommand.help.name) >= 0) {
    msg.delete(message);
    return msg.dm(message.author.id, new Embed("Error!", "\`" + requiredCommand.help.name + "\`" + " has been disabled on that channel by the server administrators."));
  }
  if (!message.channel.type && requiredCommand.help.requiredPermissions) {
    let permission = message.channel.permissionsOf(tree.client.user.id);
    let missingPerms = requiredCommand.help.requiredPermissions.filter(requiredPerm => !permission.has(requiredPerm));
    if (missingPerms.length === 1) {
      msg.delete(message);
      return msg.dm(message.author.id, "Tree doesn't have the \`" + missingPerms[0] + "\` permission that is needed to run that command!");
    }else if (missingPerms.length >= 1) {
      msg.delete(message);
      return msg.delete(message.author.id, "Tree doesn't have the " + missingPerms.map(permission => "\`" + permission + "\`").join(", ") + " permissions that are needed to run that command!");
    }
  }
  if (!requiredCommand.help.casesensitive) args = args.map(arg => arg.toLowerCase());
  if (!message.channel.type)
    tree.alterGuildData(message.channel.guild.id, "commandcount", (await tree.getGuildData(message.channel.guild.id, "commandcount")).commandcount + 1);
  requiredCommand.run(message, args, prefix);
});

tree.client.connect();
