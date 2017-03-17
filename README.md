# ohamt
Ordered Hash array mapped trie

Forked from https://github.com/mattbierner/hamt_plus

This HAMT maintains insertion order and provides multi-map methods.


## Install
ES6 source code is in `src/ohamt.js`. The library supports node, AMD, and use as a global, as long as your platform supports ES6.
TODO: bablify.

### Node
``` sh
$ npm install ohamt
```

``` javascript
var hamt = require('ohamt');

var h = hamt.empty.set('key', 'value');

...
```

## Extended API (Extends HAMT_PLUS)

#### `map.append(key, value)`
* `value` - Value to store. Hamt supports all value types, including: literals, objects, falsy values, null, and undefined. Keep in mind that only the map data structure itself is guaranteed to be immutable. Using immutable values is recommended but not required.
* `key` - String key.
* `map` - Hamt map.

Returns a new map with the value set. If the key already existed, the entry will be moved to the 'end' of the map. Does not alter the original.

----

#### `map.push(kv)`
* `kv` - Array of String key and Any value to store.
* `map` - Hamt map.

Returns a new map with the value added. If the key already existed, the original entry will not be removed. The new entry will be added to the 'end' of the map. Does not alter the original. The method uses an array to mimic array push.

----
