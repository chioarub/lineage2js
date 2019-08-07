var ProtocolVersion = require("./ProtocolVersion.js");
var RequestAuthLogin = require("./RequestAuthLogin.js");
var NewCharacter = require("./NewCharacter.js");
var Logout = require("./Logout.js");
var CharacterCreate = require("./CharacterCreate.js");

module.exports = {
	ProtocolVersion: ProtocolVersion,
	RequestAuthLogin: RequestAuthLogin,
	NewCharacter: NewCharacter,
	Logout: Logout,
	CharacterCreate: CharacterCreate
}