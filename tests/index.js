var hamt = require("../lib/ohamt");
var util = require("util");
var x = hamt.empty, ar = [];

for(var n=0;n<2600;n++){
	//var k = String.fromCharCode(n+97);
	var k = "";
	for(var i=0;i<6+Math.random() * 10;i++){
		k += String.fromCharCode(Math.floor(Math.random() * 26) + 97);
	}
	if(ar.indexOf(k)==-1) {
		ar.push(k);
	} else {
		n--;
	}
	k = "";
}

for(n = 0; n < ar.length; n++){
	x = x.set(ar[n],n);
}

// force collision

if(!x.has('uuhrvonp')) {
	ar.push('uuhrvonp');
	x = x.set('uuhrvonp',n++);
}
if(!x.has('ymmceqds')){
	ar.push('ymmceqds');
	x = x.set('ymmceqds',n++);
}
ar.push("abcdefgh");
x = x.set("abcdefgh",n++);
x = x.remove("uuhrvonp");
ar.splice(ar.indexOf("uuhrvonp"),1);


var i = 0;
for(var e of x.entries()) {
	//console.log(e)
	if(ar[i] !== e[0]) throw new Error(`Index ${i} not ok: ${i} ${ar[i]} !== ${e}`);
	i++;
}
console.log("Verified");
for(var k of hamt.keys(x)) {
	//console.log(k)
}
