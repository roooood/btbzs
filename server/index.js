var colyseus = require('colyseus');
var models = require('../app/models/');

class State {
    constructor() {
        this.started = false;
        this.turn = 0;

        this.Sit = {};
        this.simi = [];
        this.stack = [];
        this.moveable = [];
        this.userSimi = [];
    }
}
class metaData {
    constructor(options) {
        this.name = options.name;
        this.bet = options.bet;
        this.point = options.point;
        this.ready = 0;
        this.p1 = null;
        this.p2 = null;
    }
}
class Server extends colyseus.Room {
    constructor(options) {
        super(options);
        this.meta = {};
        this.player = 2;

        this.first = true;
        this.started = false;
        this.dices = [];
        this.deck = [];
        this.req = null;
        this.db = null;
        this.models = null;
        this.counter = 1;
    }
    async onInit(options) {
        this.setState(new State);
        let promise = new Promise((resolve, reject) => {
            models(function (err, ldb) {
                resolve(ldb);
            });
        });

        this.db = await promise;
        this.models = this.db.models;
    }
    requestJoin(options, isNewRoom) {
        if (options.create && isNewRoom) {
            this.meta = new metaData({
                name: options.name || 'domino',
                bet: options.bet || 5000,
                point: options.point || 150,
            });
            this.setMetadata(this.meta);
        }
        return (options.create) ?
            (options.create && isNewRoom) :
            this.clients.length > 0;
    }
    async onAuth(options) {
        let ret = null, user = null;
        ret = await this.models.user.find({ token: this.counter++ }, 1).allAsync();//options.key
        if (ret != null && ret.length > 0)
            return ret[0]
        return ret;
    }
    onJoin(client, options, auth) {
        client.id = auth.id;
        client.name = auth.fullName();
        // client.balance = auth.balance;

        if (this.first) {
            this.addPlayer(client, '1');
        } else {
            this.addPlayer(client, (this.state.Sit['1'] == null ? '1' : '2'));
        }
        // this.checkJoinRules(client);
        this.send(client, {
            welcome: {
                table: this.meta,
                info: auth
            }
        });
        this.first = false;
    }

    onMessage(client, message) {
        var type = Object.keys(message)[0];
        var value = message[type];
        switch (type) {
            case 'stack':
                if (this.req == null && client.sit == this.state.turn) {
                    this.stackHandler(client, value)
                }
                break;
            case 'pick':
                if (client.sit == this.state.turn)
                    this.pick(client, value)
                break;
        }
    }

    onLeave(client, consented) {
        if (this.started) {
            if (consented) {
                // this.giveUp(client);
            } else {
                // this.disconnected(client);
            }
        } else {
            // this.leave(client);
        }
    }
    onDispose() {

    }

    addPlayer(client, sit) {
        this.removePlayer(client);
        if (this.state.Sit[sit] == null) {
            client.sit = sit;

            if (sit == '1') {
                this.meta.p1 = client.name;
            } else {
                this.meta.p2 = client.name;
            }
            this.setMetadata(this.meta);

            this.clock.setTimeout(() => {
                this.state.Sit[sit] = {
                    id: client.id,
                    name: client.name,
                    sit: sit,
                };
                this.setClientReady();
                this.canStart();
            }, 500);
            return true;
        }
        else if (this.state.Sit[sit].disconnected == true && this.state.Sit[sit].id == client.id) {
            client.sit = sit;
            this.broadcast({
                connected: client.name
            });
            this.clock.setTimeout(() => {
                this.state.Sit[sit] = {
                    id: client.id,
                    name: client.name,
                    sit: sit,
                };
            }, 400);
            return true;
        }
        return false;

    }
    removePlayer(client) {
        if (client.sit > 0) {
            delete this.state.Sit[client.sit];
            this.setClientReady();
        }
    }
    canStart() {
        if (this.timer != undefined)
            this.timer.clear();
        this.timer = this.clock.setTimeout(() => {
            if (this.meta.ready == this.player) {
                this.start()
            }
        }, 600);
    }
    start() {
        this.started = true;
        this.setupNewGame();
    }
    setupNewGame() {
        let dices = [], i, sit, j, simi = [];
        for (i = 0; i < 7; i++) {
            for (let j = 0; j <= i; j++) {
                dices.push([i, j]);
                simi.push(true);
            }
        }
        this.dices = this.shuffle(dices);
        let diceLen = this.dices.length;
        for (i = 0; i < this.player; i++) {
            this.deck[i] = [];
            while (this.deck[i].length < 7) {
                j = Math.floor(Math.random() * diceLen);
                if (this.dices[j] != null) {
                    this.deck[i].push(this.dices[j])
                    simi[j] = false;
                    this.dices[j] = null
                }
            }
            sit = this.clientBySit(i + 1);
            if (sit > -1) {
                this.send(this.clients[sit], { dices: this.deck[i] });
            }
        }
        this.findStarter();
        let state = {
            started: true,
            stack: [],
            moveable: [],
            simi: simi,
            userSimi: [7, 7]
        }
        Object.entries(state).forEach(([key, item]) => {
            this.state[key] = item;
        });
    }
    findStarter() {
        this.state.turn = 1;
    }

    stackHandler(client, dice) {
        this.req = client.sit;
        let sit = client.sit - 1, i, j;
        for (i in this.deck[sit]) {
            j = this.deck[sit][i];
            if (dice.number.every(v => j.includes(v))) {
                this.deck[sit].splice(i, 1);
                this.send(client, { dices: this.deck[sit] });
                break;
            }
        }

        this.state.userSimi[sit] = this.state.userSimi[sit] - 1;
        this.state.stack.push(this.clone(dice));
        let target = this.state.stack.length;

        if (target == 1) {
            this.state.moveable = dice.number;
        }
        else if (dice.index > 0) {
            this.state.moveable[1] = dice.number[1];
        }
        else {
            this.state.moveable[0] = dice.number[1];
        }
        this.clock.setTimeout(() => {
            this.next();
        }, 500);
    }
    next() {
        this.req = null;
        let next = this.state.turn == 1 ? 2 : 1;
        this.state.turn = next;

        let have = this.deck[next - 1].some(v => v.some(b => this.state.moveable.includes(b)));
        if (!have) {
            let sit = this.clientBySit(next);
            if (sit > -1) {
                this.send(this.clients[sit], { pick: true });
            }
        }
    }
    pick(client, i) {
        let j = client.sit - 1;
        let dice = this.dices[i];
        if (dice != null) {
            this.deck[j].push(dice);
            this.state.simi[i] = false;
            this.dices[i] = null;

            this.send(client, { dices: this.deck[j] });
            if (!(this.state.moveable.some(v => dice.includes(v)))) {
                this.send(client, { pick: true });
            }
        }
    }
    checkJoinRules(client) {
        var i;
        for (i in this.clients) {
            if (this.clients[i].id == client.id && client.sessionId != this.clients[i].sessionId) {
                client.close();
            }
        }
    }
    setClientReady() {
        this.meta.ready = Object.keys(this.state.Sit).length;
        this.setMetadata(this.meta);
    }
    clientBySit(sit) {
        var ret = -1, i;
        for (i in this.clients) {
            if (this.clients[i].sit == sit) {
                ret = i;
                break;
            }
        }
        return ret;
    }
    shuffle(arr, level = 1) {
        var a, b, c;
        for (a = 0; a < level; a++) {
            for (b = arr.length - 1; b > 0; b--) {
                c = Math.floor(Math.random() * (b + 1));
                [arr[b], arr[c]] = [arr[c], arr[b]];
            }
        }
        return arr;
    }
    clone(arr) {
        let newObj = (arr instanceof Array) ? [] : {};
        for (let i in arr) {
            if (arr[i] && typeof arr[i] == "object") {
                newObj[i] = this.clone(arr[i]);
            }
            else
                newObj[i] = arr[i]
        }
        return newObj;
    }
}



module.exports = Server;