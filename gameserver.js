var net = require("net");
var file = require("fs");
var XOR = require("./util/XOR.js");
var log = require("./util/log.js");
var IdFactory = require("./util/IdFactory.js");
var config = require("./config/config.js");
var errorCodes = require("./config/errorCodes.js");
var Player = require("./gameserver/Player.js");
var Players = require("./gameserver/Players.js");
var SendPacket = require("./gameserver/SendPacket.js");
var serverPackets = require("./gameserver/serverpackets/serverPackets.js");
var clientPackets = require("./gameserver/clientpackets/clientPackets.js");
var tables = require("./gameserver/tables/tables.js");
var templates = require("./gameserver/templates/templates.js");
var classId = require("./data/class_id.js");
var characterTemplatesData = require("./data/character_templates.js");
// DB
var low = require("lowdb");
var FileSync = require("lowdb/adapters/FileSync");
var database = new FileSync("data/database.json");
var db = low(database);
// Init object
var idFactory = new IdFactory("data/idstate.json");
var players = new Players();

// Data - файл
// Table - сериализация данных
// Template - взаимодействие с данными через get/set

function socketHandler(socket) {
	var encryption = false;
	var xor = new XOR(config.base.key.XOR);
	var player = new Player();
	var sendPacket = new SendPacket(player, players.getPlayers());
	var sessionKey1Server = [0x55555555, 0x44444444];
	var sessionKey2Server = [0x55555555, 0x44444444];

	socket.on("data", data => {
		var packet = new Buffer.from(data, "binary").slice(2); // slice(2) - without byte responsible for packet size
		var decryptedPacket = new Buffer.from(encryption ? player.xor.decrypt(packet) : packet);
		var packetType = packet[0];
		
		// for test
		log(packet);
		//

		packetHandler(packetType, decryptedPacket);

		function packetHandler(type, packet) {
			switch(type) {
				case 0x00:
					var protocolVersion = new clientPackets.ProtocolVersion(packet);
					
					if(protocolVersion.getVersion() === config.base.PROTOCOL_VERSION.CLIENT) {
						sendPacket.send(new serverPackets.CryptInit(config.base.key.XOR), false);
						encryption = true; // The first packet is not encrypted
					}
					break;
				case 0x08:
					var requestAuthLogin = new clientPackets.RequestAuthLogin(packet);
					var sessionKey1Client = requestAuthLogin.getSessionKey1();
					var sessionKey2Client = requestAuthLogin.getSessionKey2();
					var charactersList = [];
					var charactersData;

					player.login = requestAuthLogin.getLogin();
					charactersData = db.get("characters").filter({"accountName": player.login}).value();

					for(var i = 0; i < charactersData.length; i++) {
						charactersList.push(new templates.L2CharacterTemplate(charactersData[i]));
					}

					if(keyComparison(sessionKey1Server, sessionKey1Client) && keyComparison(sessionKey2Server, sessionKey2Client)) {
						// Загружать из БД список персонажей
						sendPacket.send(new serverPackets.CharacterSelectInfo(charactersList, player.login));
					} else {
						sendPacket.send(new serverPackets.AuthLoginFail(errorCodes.gameserver.authLoginFail.REASON_SYSTEM_ERROR));
					}

					break;
				case 0x0e:
					var newCharacter = new clientPackets.NewCharacter(packet);
					// Получаем и преобразуем данные из одного объекта в другой чтобы удобно было доставать данные по classId
					var characterTemplateTable = (new tables.CharacterTemplateTable(characterTemplatesData)).getData();
					var characterTamplates = [
						new templates.L2CharacterTemplate(characterTemplateTable[classId.fighter]),
						new templates.L2CharacterTemplate(characterTemplateTable[classId.mage]),
						new templates.L2CharacterTemplate(characterTemplateTable[classId.elvenFighter]),
						new templates.L2CharacterTemplate(characterTemplateTable[classId.elvenMage]),
						new templates.L2CharacterTemplate(characterTemplateTable[classId.darkFighter]),
						new templates.L2CharacterTemplate(characterTemplateTable[classId.darkMage]),
						new templates.L2CharacterTemplate(characterTemplateTable[classId.orcFighter]),
						new templates.L2CharacterTemplate(characterTemplateTable[classId.orcMage]),
						new templates.L2CharacterTemplate(characterTemplateTable[classId.dwarvenFighter]),
					];
						
					sendPacket.send(new serverPackets.CharacterTemplates(characterTamplates));

					break;
				case 0x09:
					var logout = new clientPackets.Logout(packet);

					xor = new XOR(config.base.key.XOR);
					encryption = false;
					sendPacket.send(new serverPackets.LogoutOK());

					break;
				case 0x0b:
					var characterCreate = new clientPackets.CharacterCreate(packet);
					var characterName = characterCreate.getCharacterName();
					var characterTemplateTable = (new tables.CharacterTemplateTable(characterTemplatesData)).getData();
					var characterQuantity = db.get("characters").filter({"accountName": player.login}).value().length;
					var MAXIMUM_QUANTITY_CHARACTERS = 7;

					if(characterQuantity === MAXIMUM_QUANTITY_CHARACTERS) {
						sendPacket.send(new serverPackets.CharacterCreateFail(errorCodes.gameserver.characterCreateFail.REASON_TOO_MANY_CHARACTERS));
						break;
					}

					if(characterName.length <= 16 && isAlphaNumeric(characterName)) {
						if(characterNameisExist(characterName)) {
							var character = new templates.L2CharacterTemplate(characterTemplateTable[characterCreate.getClassId()]);
							var charactersData;
							var charactersList = [];

							character.setAccountName(player.login);
							character.setObjectId(idFactory.getNextId());
							character.setCharacterName(characterCreate.getCharacterName());
							character.setTitle("");
							character.setMaximumHp(character.getHp());
							character.setMaximumMp(character.getMp());
							character.setExp(0);
							character.setSp(0);
							character.setGender(characterCreate.getGender());
							character.setHairStyle(characterCreate.getHairStyle());
							character.setHairColor(characterCreate.getHairColor());
							character.setHeading(0);
							character.setFace(characterCreate.getFace());
							character.setLevel(1);
							character.setPvp(0);
							character.setPk(0);
							character.setKarma(0);
							character.setAccessLevel(0);
							character.setClanId(0);
							character.setOnline(0);
							character.setOnlineTime(0);

							db.get("characters").push(character.getData()).write();
							charactersData = db.get("characters").filter({"accountName": player.login}).value();
							
							for(var i = 0; i < charactersData.length; i++) {
								charactersList.push(new templates.L2CharacterTemplate(charactersData[i]));
							}

							sendPacket.send(new serverPackets.CharacterCreateSuccess());
							sendPacket.send(new serverPackets.CharacterSelectInfo(charactersList, player.login));
						} else {
							sendPacket.send(new serverPackets.CharacterCreateFail(errorCodes.gameserver.characterCreateFail.REASON_NAME_ALREADY_EXISTS));
						}
					} else {
						sendPacket.send(new serverPackets.CharacterCreateFail(errorCodes.gameserver.characterCreateFail.REASON_16_ENG_CHARS));
					}

					function characterNameisExist(characterName) {
						var names = db.get("characters").map("characterName").value();

						for(var i = 0; i < names.length; i++) {
							if(names[i].toLowerCase() === characterName.toLowerCase()) {
								return false;
							}
						}

						return true;
					}

					function isAlphaNumeric(string) {
						var charCode;
						
						for(var i = 0; i < string.length; i++) {
					  		charCode = string[i].charCodeAt();
						  	
						  	if (!(charCode > 47 && charCode < 58) && // numeric (0-9)
						        !(charCode > 64 && charCode < 91) && // upper alpha (A-Z)
						        !(charCode > 96 && charCode < 123)) { // lower alpha (a-z)
						    	return false;
						    }
						}
					  
					  return true;
					}

					break;
				case 0x0d:
					var characterSelected = new clientPackets.CharacterSelected(packet);
					player.characterSlot = characterSelected.getCharacterSlot();
					var characterData = db.get("characters").filter({"accountName": player.login}).value()[player.characterSlot];
					var character = new templates.L2CharacterTemplate(characterData);

					sendPacket.send(new serverPackets.CharacterSelected(character));

					break;
				case 0x63:
					var requestQuestList = new clientPackets.RequestQuestList(packet);

					sendPacket.send(new serverPackets.QuestList(/* remove */)); // database - quests

					break;
				case 0x03:
					var enterWorld = new clientPackets.EnterWorld(packet);
					var characterData = db.get("characters").filter({"accountName": player.login}).value()[player.characterSlot];
					var character = new templates.L2CharacterTemplate(characterData);
					
					player.id = character.getObjectId();
					player.positions = { x: character.getX(), y: character.getY(), z: character.getZ() };
					player.online = true;
					player.characterName = character.getCharacterName();

					sendPacket.send(new serverPackets.SunRise()); // восход
					sendPacket.send(new serverPackets.UserInfo(character));
					sendPacket.broadcast(new serverPackets.CharacterInfo(character)); // Оповестить всех, что персонаж зашел в мир
					// sendPacket.send(new serverPackets.NpcInfo());
					// sendPacket.send(new serverPackets.MoveToLocation(/* npc */));

					player.getVisiblePlayers(players.getPlayers(), function(players) {
						var characterData = db.get("characters").filter({"accountName": players.login}).value()[players.characterSlot];
						var character = new templates.L2CharacterTemplate(characterData);

						character.setX(players.positions.x);
						character.setY(players.positions.y);
						character.setZ(players.positions.z);
						sendPacket.send(new serverPackets.CharacterInfo(character));
					});

					break;
				case 0x01:
					var moveBackwardToLocation = new clientPackets.MoveBackwardToLocation(packet);
					var characterData = db.get("characters").filter({"accountName": player.login}).value()[player.characterSlot];
					var character = new templates.L2CharacterTemplate(characterData);
					var positions = {
						target: {
							x: moveBackwardToLocation.getTargetX(),
							y: moveBackwardToLocation.getTargetY(),
							z: moveBackwardToLocation.getTargetZ()
						},
						origin: {
							x: moveBackwardToLocation.getOriginX(),
							y: moveBackwardToLocation.getOriginY(),
							z: moveBackwardToLocation.getOriginZ()
						}
					}

					sendPacket.send(new serverPackets.MoveToLocation(positions, character));
					sendPacket.broadcast(new serverPackets.MoveToLocation(positions, character));

					player.positions = { x: positions.target.x, y: positions.target.y, z: positions.target.z };

					break;
				case 0x1b:
					var requestSocialAction = new clientPackets.RequestSocialAction(packet);
					var actionId = requestSocialAction.getActionId();

					sendPacket.send(new serverPackets.SocialAction(player.id, actionId));
					sendPacket.broadcast(new serverPackets.SocialAction(player.id, actionId));

					break;
				case 0x38:
					var say2 = new clientPackets.Say2(packet);

					sendPacket.send(new serverPackets.CreateSay(player.id, say2.getType(), player.characterName, say2.getText()));
					sendPacket.broadcast(new serverPackets.CreateSay(player.id, say2.getType(), player.characterName, say2.getText()));

					break;
				case 0x36:
					var stopMove = new clientPackets.StopMove(packet);

					player.positions = { x: stopMove.getX(), y: stopMove.getY(), z: stopMove.getZ() };
					sendPacket.send(new serverPackets.StopMoveWithLocation(player));

					break;
				case 0x45:
					var requestActionUse = new clientPackets.RequestActionUse(packet);

					switch(requestActionUse.getActionId()) {
						case 0:
							var waitType = player.getWaitType() ^ 0x01 // 1 => 0, 0 => 1

							sendPacket.send(new serverPackets.ChangeWaitType(player, waitType));
							sendPacket.broadcast(new serverPackets.ChangeWaitType(player, waitType));
							player.setWaitType(waitType);

							break;
						case 1:
							var moveType = player.getMoveType() ^ 0x01 // 1 => 0, 0 => 1

							sendPacket.send(new serverPackets.ChangeMoveType(player, moveType));
							sendPacket.broadcast(new serverPackets.ChangeMoveType(player, moveType));
							player.setMoveType(moveType);
					}

					break;
			}
		}

		function keyComparison(keyServer, keyClient) {
			if(keyServer[0] === parseInt(keyClient[0], 16) && keyServer[1] === parseInt(keyClient[1], 16)) {
				return true;
			} else {
				return false;
			}
		}
	})

	socket.on("close", () => {
		log(`Connection to the game server is closed for: ${socket.remoteAddress}:${socket.remotePort}`);
	})

	socket.on("error", () => {
		log(`Client connection lost for: ${socket.remoteAddress}:${socket.remotePort}`);
	})

	function userHasJoined() {
		log(`Connected to the game server: ${socket.remoteAddress}:${socket.remotePort}`);
	}

	function Init() {
		player.socket = socket;
		player.xor = xor;
		players.addPlayer(player);
		socket.setEncoding("binary");
		userHasJoined();
	}

	Init();
}

function Init() {
	net.createServer(socketHandler).listen(config.gameserver.port, config.gameserver.host, () => {
		log(`Game server listening on ${config.gameserver.host}:${config.gameserver.port}`)
	});
}

Init();