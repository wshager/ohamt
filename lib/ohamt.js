'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
/**
    @fileOverview Hash Array Mapped Trie.

    Code based on: https://github.com/exclipy/pdata
*/

/* Configuration
 ******************************************************************************/
const SIZE = 5;

const BUCKET_SIZE = Math.pow(2, SIZE);

const MASK = BUCKET_SIZE - 1;

const MAX_INDEX_NODE = BUCKET_SIZE / 2;

const MIN_ARRAY_NODE = BUCKET_SIZE / 4;

/*
 ******************************************************************************/
const nothing = {};

const constant = x => () => x;

/**
    Get 32 bit hash of string.

    Based on:
    http://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript-jquery
*/
const hash = exports.hash = str => {
    const type = typeof str;
    if (type === 'number') return str;
    if (type !== 'string') str += '';

    let hash = 0;
    for (let i = 0, len = str.length; i < len; ++i) {
        const c = str.charCodeAt(i);
        hash = (hash << 5) - hash + c | 0;
    }
    return hash;
};

/* Bit Ops
 ******************************************************************************/
/**
    Hamming weight.

    Taken from: http://jsperf.com/hamming-weight
*/
const popcount = v => {
    v -= v >>> 1 & 0x55555555; // works with signed or unsigned shifts
    v = (v & 0x33333333) + (v >>> 2 & 0x33333333);
    return (v + (v >>> 4) & 0xF0F0F0F) * 0x1010101 >>> 24;
};

const hashFragment = (shift, h) => h >>> shift & MASK;

const toBitmap = x => 1 << x;

const fromBitmap = (bitmap, bit) => popcount(bitmap & bit - 1);

/* Array Ops
 ******************************************************************************/
/**
    Set a value in an array.

    @param mutate Should the input array be mutated?
    @param at Index to change.
    @param v New value
    @param arr Array.
*/
const arrayUpdate = (mutate, at, v, arr) => {
    let out = arr;
    if (!mutate) {
        const len = arr.length;
        out = new Array(len);
        for (let i = 0; i < len; ++i) out[i] = arr[i];
    }
    out[at] = v;
    return out;
};

/**
    Remove a value from an array.

    @param mutate Should the input array be mutated?
    @param at Index to remove.
    @param arr Array.
*/
const arraySpliceOut = (mutate, at, arr) => {
    const len = arr.length - 1;
    let i = 0,
        g = 0;
    let out = arr;
    if (mutate) {
        g = i = at;
    } else {
        out = new Array(len);
        while (i < at) out[g++] = arr[i++];
    }
    ++i;
    while (i <= len) out[g++] = arr[i++];
    out.length = len;
    return out;
};

/**
    Insert a value into an array.

    @param mutate Should the input array be mutated?
    @param at Index to insert at.
    @param v Value to insert,
    @param arr Array.
*/
const arraySpliceIn = (mutate, at, v, arr) => {
    const len = arr.length;
    if (mutate) {
        let i = len;
        while (i >= at) arr[i--] = arr[i];
        arr[at] = v;
        return arr;
    }
    let i = 0,
        g = 0;
    const out = new Array(len + 1);
    while (i < at) out[g++] = arr[i++];
    out[at] = v;
    while (i < len) out[++g] = arr[i++];
    return out;
};

/* Node Structures
 ******************************************************************************/
const LEAF = 1;
const COLLISION = 2;
const INDEX = 3;
const ARRAY = 4;
const MULTI = 5;

/**
    Empty node.
*/
const emptyNode = {
    __hamt_isEmpty: true
};

const isEmptyNode = x => x === emptyNode || x && x.__hamt_isEmpty;

/**
    Leaf holding a value.

    @member edit Edit of the node.
    @member hash Hash of key.
    @member key Key.
    @member value Value stored.
*/
const Leaf = (edit, hash, key, value, prev, id, next) => ({
    type: LEAF,
    edit: edit,
    hash: hash,
    key: key,
    value: value,
    prev: prev,
    next: next,
    id: id,
    _modify: Leaf__modify
});

/**
    Leaf holding multiple values with the same hash but different keys.

    @member edit Edit of the node.
    @member hash Hash of key.
    @member children Array of collision children node.
*/
const Collision = (edit, hash, children) => ({
    type: COLLISION,
    edit: edit,
    hash: hash,
    children: children,
    _modify: Collision__modify
});

/**
    Internal node with a sparse set of children.

    Uses a bitmap and array to pack children.

  @member edit Edit of the node.
    @member mask Bitmap that encode the positions of children in the array.
    @member children Array of child nodes.
*/
const IndexedNode = (edit, mask, children) => ({
    type: INDEX,
    edit: edit,
    mask: mask,
    children: children,
    _modify: IndexedNode__modify
});

/**
    Internal node with many children.

    @member edit Edit of the node.
    @member size Number of children.
    @member children Array of child nodes.
*/
const ArrayNode = (edit, size, children) => ({
    type: ARRAY,
    edit: edit,
    size: size,
    children: children,
    _modify: ArrayNode__modify
});

const Multi = (edit, hash, key, children) => ({
    type: MULTI,
    edit: edit,
    hash: hash,
    key: key,
    children: children,
    _modify: Multi__modify
});

/**
    Is `node` a leaf node?
*/
const isLeaf = node => node === emptyNode || node.type === LEAF || node.type === COLLISION;

/* Internal node operations.
 ******************************************************************************/
/**
    Expand an indexed node into an array node.

  @param edit Current edit.
    @param frag Index of added child.
    @param child Added child.
    @param mask Index node mask before child added.
    @param subNodes Index node children before child added.
*/
const expand = (edit, frag, child, bitmap, subNodes) => {
    const arr = [];
    let bit = bitmap;
    let count = 0;
    for (let i = 0; bit; ++i) {
        if (bit & 1) arr[i] = subNodes[count++];
        bit >>>= 1;
    }
    arr[frag] = child;
    return ArrayNode(edit, count + 1, arr);
};

/**
    Collapse an array node into a indexed node.

  @param edit Current edit.
    @param count Number of elements in new array.
    @param removed Index of removed element.
    @param elements Array node children before remove.
*/
const pack = (edit, count, removed, elements) => {
    const children = new Array(count - 1);
    let g = 0;
    let bitmap = 0;
    for (let i = 0, len = elements.length; i < len; ++i) {
        if (i !== removed) {
            const elem = elements[i];
            if (elem && !isEmptyNode(elem)) {
                children[g++] = elem;
                bitmap |= 1 << i;
            }
        }
    }
    return IndexedNode(edit, bitmap, children);
};

/**
    Merge two leaf nodes.

    @param shift Current shift.
    @param h1 Node 1 hash.
    @param n1 Node 1.
    @param h2 Node 2 hash.
    @param n2 Node 2.
*/
const mergeLeaves = (edit, shift, h1, n1, h2, n2) => {
    if (h1 === h2) return Collision(edit, h1, [n2, n1]);

    const subH1 = hashFragment(shift, h1);
    const subH2 = hashFragment(shift, h2);
    return IndexedNode(edit, toBitmap(subH1) | toBitmap(subH2), subH1 === subH2 ? [mergeLeaves(edit, shift + SIZE, h1, n1, h2, n2)] : subH1 < subH2 ? [n1, n2] : [n2, n1]);
};

/**
    Update an entry in a collision list.

    @param mutate Should mutation be used?
    @param edit Current edit.
    @param keyEq Key compare function.
    @param hash Hash of collision.
    @param list Collision list.
    @param f Update function.
    @param k Key to update.
    @param size Size ref.
*/
const updateCollisionList = (mutate, edit, keyEq, h, list, f, k, size, insert, multi) => {
    const len = list.length;
    for (let i = 0; i < len; ++i) {
        const child = list[i];
        if (keyEq(k, child.key)) {
            const value = child.value;
            const newValue = f(value);
            if (newValue === value) return list;

            if (newValue === nothing) {
                --size.value;
                return arraySpliceOut(mutate, i, list);
            }
            return arrayUpdate(mutate, i, Leaf(edit, h, k, newValue, insert), list);
        }
    }

    const newValue = f();
    if (newValue === nothing) return list;
    ++size.value;
    return arrayUpdate(mutate, len, Leaf(edit, h, k, newValue, insert), list);
};

const updateMultiList = (mutate, edit, h, list, f, k, size, insert, multi) => {
    var len = list.length;
    var newValue = f();
    if (newValue === nothing) {
        --size.value;
        var idx = len - 1;
        for (; idx >= 0; idx--) if (list[idx].id === multi) break;
        return arraySpliceOut(mutate, idx, list);
    }
    ++size.value;
    return arrayUpdate(mutate, len, Leaf(edit, h, k, newValue, insert, list[len - 1].id + 1), list);
};

const canEditNode = (edit, node) => edit === node.edit;

/* Editing
 ******************************************************************************/
const Leaf__modify = function (edit, keyEq, shift, f, h, k, size, insert, multi) {
    var leaf;
    if (keyEq(k, this.key)) {
        let v = f(this.value);
        if (v === nothing) {
            --size.value;
            return emptyNode;
        }
        if (multi) {
            leaf = this;
        } else {
            if (v === this.value) return this;
            if (canEditNode(edit, this)) {
                this.value = v;
                this.prev = insert || this.prev;
                return this;
            }
            return Leaf(edit, h, k, v, insert || this.prev, 0, this.next);
        }
    }
    let v = f();
    if (v === nothing) return this;
    ++size.value;
    if (multi && leaf) {
        //if(v===leaf.value) throw new Error("Either key or value must be unique in a multimap");
        return Multi(edit, h, k, [leaf, Leaf(edit, h, k, v, insert, multi)]);
    }
    return mergeLeaves(edit, shift, this.hash, this, h, Leaf(edit, h, k, v, insert, 0));
};

const Collision__modify = function (edit, keyEq, shift, f, h, k, size, insert, multi) {
    if (h === this.hash) {
        const canEdit = canEditNode(edit, this);
        const list = updateCollisionList(canEdit, edit, keyEq, this.hash, this.children, f, k, size, insert);
        if (list === this.children) return this;

        return list.length > 1 ? Collision(edit, this.hash, list) : list[0]; // collapse single element collision list
    }
    const v = f();
    if (v === nothing) return this;
    ++size.value;
    return mergeLeaves(edit, shift, this.hash, this, h, Leaf(edit, h, k, v, insert, 0));
};

const IndexedNode__modify = function (edit, keyEq, shift, f, h, k, size, insert, multi) {
    const mask = this.mask;
    const children = this.children;
    const frag = hashFragment(shift, h);
    const bit = toBitmap(frag);
    const indx = fromBitmap(mask, bit);
    const exists = mask & bit;
    const current = exists ? children[indx] : emptyNode;
    const child = current._modify(edit, keyEq, shift + SIZE, f, h, k, size, insert, multi);

    if (current === child) return this;

    const canEdit = canEditNode(edit, this);
    let bitmap = mask;
    let newChildren;
    if (exists && isEmptyNode(child)) {
        // remove
        bitmap &= ~bit;
        if (!bitmap) return emptyNode;
        if (children.length <= 2 && isLeaf(children[indx ^ 1])) return children[indx ^ 1]; // collapse

        newChildren = arraySpliceOut(canEdit, indx, children);
    } else if (!exists && !isEmptyNode(child)) {
        // add
        if (children.length >= MAX_INDEX_NODE) return expand(edit, frag, child, mask, children);

        bitmap |= bit;
        newChildren = arraySpliceIn(canEdit, indx, child, children);
    } else {
        // modify
        newChildren = arrayUpdate(canEdit, indx, child, children);
    }

    if (canEdit) {
        this.mask = bitmap;
        this.children = newChildren;
        return this;
    }
    return IndexedNode(edit, bitmap, newChildren);
};

const ArrayNode__modify = function (edit, keyEq, shift, f, h, k, size, insert, multi) {
    let count = this.size;
    const children = this.children;
    const frag = hashFragment(shift, h);
    const child = children[frag];
    const newChild = (child || emptyNode)._modify(edit, keyEq, shift + SIZE, f, h, k, size);

    if (child === newChild) return this;

    const canEdit = canEditNode(edit, this);
    let newChildren;
    if (isEmptyNode(child) && !isEmptyNode(newChild)) {
        // add
        ++count;
        newChildren = arrayUpdate(canEdit, frag, newChild, children);
    } else if (!isEmptyNode(child) && isEmptyNode(newChild)) {
        // remove
        --count;
        if (count <= MIN_ARRAY_NODE) return pack(edit, count, frag, children);
        newChildren = arrayUpdate(canEdit, frag, emptyNode, children);
    } else {
        // modify
        newChildren = arrayUpdate(canEdit, frag, newChild, children);
    }

    if (canEdit) {
        this.size = count;
        this.children = newChildren;
        return this;
    }
    return ArrayNode(edit, count, newChildren);
};

const Multi__modify = function (edit, keyEq, shift, f, h, k, size, insert, multi) {
    if (keyEq(k, this.key)) {
        // modify
        const canEdit = canEditNode(edit, this);
        var list = this.children;
        // if Multi exists, find leaf
        list = updateMultiList(canEdit, edit, h, list, f, k, size, insert, multi);
        if (list === this.children) return this;

        if (list.length > 1) return Multi(edit, h, k, list);
        // collapse single element collision list
        return list[0];
    }
    let v = f();
    if (v === nothing) return this;
    ++size.value;
    return mergeLeaves(edit, shift, this.hash, this, h, Leaf(edit, h, k, v, insert, 0));
};

emptyNode._modify = (edit, keyEq, shift, f, h, k, size, insert) => {
    const v = f();
    if (v === nothing) return emptyNode;
    ++size.value;
    return Leaf(edit, h, k, v, insert, 0);
};

/* Ordered / Multi helpers
 ******************************************************************************/

function getLeafOrMulti(node, hash, key) {
    var s = 0,
        len = 0;
    while (node && node.type > 1) {
        if (node.type == 2) {
            len = node.children.length;
            for (var i = 0; i < len; i++) {
                var c = node.children[i];
                if (c.key === key) {
                    node = c;
                    break;
                }
            }
        } else if (node.type == 3) {
            var frag = hashFragment(s, hash);
            var bit = toBitmap(frag);
            if (node.mask & bit) {
                node = node.children[fromBitmap(node.mask, bit)];
            } else {
                return;
            }
            s += SIZE;
        } else if (node.type == 4) {
            node = node.children[hashFragment(s, hash)];
            s += SIZE;
        } else {
            // just return
            if (node.key === key) {
                return node;
            } else {
                return;
            }
        }
    }
    if (node.key === key) return node;
}

function getLeafFromMulti(node, id) {
    for (var i = 0, len = node.children.length; i < len; i++) {
        var c = node.children[i];
        if (c.id === id) return c;
    }
}

function getLeafFromMultiV(node, val) {
    for (var i = 0, len = node.children.length; i < len; i++) {
        var c = node.children[i];
        if (c.value === val) return c;
    }
}

function updatePosition(parent, edit, entry, val, prev = false, s = 0) {
    var len = 0,
        type = parent.type,
        node = null,
        idx = 0,
        hash = entry[0],
        key = entry[1],
        id = entry[2];
    if (type == 1) {
        return Leaf(edit, parent.hash, parent.key, parent.value, prev ? val : parent.prev, parent.id, prev ? parent.next : val);
    }
    var children = parent.children;
    if (type == 2) {
        len = children.length;
        for (; idx < len; ++idx) {
            node = children[idx];
            if (key === node.key) break;
        }
    } else if (type == 3) {
        var frag = hashFragment(s, hash);
        var bit = toBitmap(frag);
        if (parent.mask & bit) {
            idx = fromBitmap(parent.mask, bit);
            node = children[idx];
            s += SIZE;
        }
    } else if (type == 4) {
        idx = hashFragment(s, hash);
        node = children[idx];
        s += SIZE;
    } else if (type == 5) {
        // assume not in use
        len = children.length;
        for (; idx < len;) {
            node = children[idx];
            if (node.id === id) break;
            idx++;
        }
    }
    if (node) {
        children = arrayUpdate(canEditNode(edit, node), idx, updatePosition(node, edit, entry, val, prev, s), children);
        if (type == 2) {
            return Collision(edit, parent.hash, children);
        } else if (type == 3) {
            return IndexedNode(edit, parent.mask, children);
        } else if (type == 4) {
            return ArrayNode(edit, parent.size, children);
        } else if (type == 5) {
            return Multi(edit, hash, key, children);
        }
    }
    return parent;
}

function last(arr) {
    return arr[arr.length - 1];
}

/*
 ******************************************************************************/
function Map(editable, edit, config, root, size, start, insert) {
    this._editable = editable;
    this._edit = edit;
    this._config = config;
    this._root = root;
    this._size = size;
    this._start = start;
    this._insert = insert;
}

Map.prototype.setTree = function (newRoot, newSize, insert) {
    var start = newSize == 1 ? insert : this._start;
    if (this._editable) {
        this._root = newRoot;
        this._size = newSize;
        this._insert = insert;
        this._start = start;
        return this;
    }
    return newRoot === this._root ? this : new Map(this._editable, this._edit, this._config, newRoot, newSize, start, insert);
};

/* Queries
 ******************************************************************************/
/**
    Lookup the value for `key` in `map` using a custom `hash`.

    Returns the value or `alt` if none.
*/
const tryGetHash = exports.tryGetHash = (alt, hash, key, map) => {
    let node = map._root;
    let shift = 0;
    const keyEq = map._config.keyEq;
    while (true) switch (node.type) {
        case LEAF:
            {
                return keyEq(key, node.key) ? node.value : alt;
            }
        case COLLISION:
            {
                if (hash === node.hash) {
                    const children = node.children;
                    for (let i = 0, len = children.length; i < len; ++i) {
                        const child = children[i];
                        if (keyEq(key, child.key)) return child.value;
                    }
                }
                return alt;
            }
        case INDEX:
            {
                const frag = hashFragment(shift, hash);
                const bit = toBitmap(frag);
                if (node.mask & bit) {
                    node = node.children[fromBitmap(node.mask, bit)];
                    shift += SIZE;
                    break;
                }
                return alt;
            }
        case ARRAY:
            {
                node = node.children[hashFragment(shift, hash)];
                if (node) {
                    shift += SIZE;
                    break;
                }
                return alt;
            }
        case MULTI:
            {
                var ret = [];
                for (let i = 0, len = node.children.length; i < len; i++) {
                    var c = node.children[i];
                    ret.push(c.value);
                }
                return ret;
            }
        default:
            return alt;
    }
};

Map.prototype.tryGetHash = function (alt, hash, key) {
    return tryGetHash(alt, hash, key, this);
};

/**
    Lookup the value for `key` in `map` using internal hash function.

    @see `tryGetHash`
*/
const tryGet = exports.tryGet = (alt, key, map) => tryGetHash(alt, map._config.hash(key), key, map);

Map.prototype.tryGet = function (alt, key) {
    return tryGet(alt, key, this);
};

/**
    Lookup the value for `key` in `map` using a custom `hash`.

    Returns the value or `undefined` if none.
*/
const getHash = exports.getHash = (hash, key, map) => tryGetHash(undefined, hash, key, map);

Map.prototype.getHash = function (hash, key) {
    return getHash(hash, key, this);
};

/**
    Lookup the value for `key` in `map` using internal hash function.

    @see `get`
*/
const get = exports.get = (key, map) => tryGetHash(undefined, map._config.hash(key), key, map);

Map.prototype.get = function (key, alt) {
    return tryGet(alt, key, this);
};

Map.prototype.first = function () {
    var start = this._start;
    var node = getLeafOrMulti(this._root, start[0], start[1]);
    if (node.type == MULTI) node = getLeafFromMulti(node, start[2]);
    return node.value;
};

Map.prototype.last = function () {
    var end = this._init;
    var node = getLeafOrMulti(this._root, end[0], end[1]);
    if (node.type == MULTI) node = getLeafFromMulti(node, end[2]);
    return node.value;
};

Map.prototype.next = function (key, val) {
    var node = getLeafOrMulti(this._root, hash(key), key);
    if (node.type == MULTI) {
        node = getLeafFromMultiV(node, val);
    }
    if (node.next === undefined) return;
    var next = getLeafOrMulti(this._root, node.next[0], node.next[1]);
    if (next.type == MULTI) {
        next = getLeafFromMulti(next, node.next[2]);
    }
    return next.value;
};

/**
    Does an entry exist for `key` in `map`? Uses custom `hash`.
*/
const hasHash = exports.hasHash = (hash, key, map) => tryGetHash(nothing, hash, key, map) !== nothing;

Map.prototype.hasHash = function (hash, key) {
    return hasHash(hash, key, this);
};

/**
    Does an entry exist for `key` in `map`? Uses internal hash function.
*/
const has = exports.has = (key, map) => hasHash(map._config.hash(key), key, map);

Map.prototype.has = function (key) {
    return has(key, this);
};

const defKeyCompare = (x, y) => x === y;

/**
    Create an empty map.

    @param config Configuration.
*/
const make = exports.make = config => new Map(0, 0, {
    keyEq: config && config.keyEq || defKeyCompare,
    hash: config && config.hash || hash
}, emptyNode, 0);

/**
    Empty map.
*/
const empty = exports.empty = make();

/**
    Does `map` contain any elements?
*/
const isEmpty = exports.isEmpty = map => map && !!isEmptyNode(map._root);

Map.prototype.isEmpty = function () {
    return isEmpty(this);
};

/* Updates
 ******************************************************************************/
/**
    Alter the value stored for `key` in `map` using function `f` using
    custom hash.

    `f` is invoked with the current value for `k` if it exists,
    or no arguments if no such value exists. `modify` will always either
    update or insert a value into the map.

    Returns a map with the modified value. Does not alter `map`.
*/
const modifyHash = exports.modifyHash = (f, hash, key, insert, multi, map) => {
    const size = { value: map._size };
    const newRoot = map._root._modify(map._editable ? map._edit : NaN, map._config.keyEq, 0, f, hash, key, size, insert, multi);
    return map.setTree(newRoot, size.value, insert || !map._size ? [hash, key, multi] : map._insert);
};

Map.prototype.modifyHash = function (hash, key, f) {
    return modifyHash(f, hash, key, this.has(key), false, this);
};

/**
    Alter the value stored for `key` in `map` using function `f` using
    internal hash function.

    @see `modifyHash`
*/
const modify = exports.modify = (f, key, map) => modifyHash(f, map._config.hash(key), key, map.has(key), false, map);

Map.prototype.modify = function (key, f) {
    return modify(f, key, this);
};

/**
    Store `value` for `key` in `map` using custom `hash`.

    Returns a map with the modified value. Does not alter `map`.
*/
const setHash = exports.setHash = (hash, key, value, map) => appendHash(hash, key, value, map.has(key), map);

Map.prototype.setHash = function (hash, key, value) {
    return setHash(hash, key, value, this);
};

const appendHash = exports.appendHash = function (hash, key, value, exists, map) {
    var insert = map._insert;
    map = modifyHash(constant(value), hash, key, exists ? null : insert, 0, map);
    if (insert && !exists) {
        const edit = map._editable ? map._edit : NaN;
        map._root = updatePosition(map._root, edit, insert, [hash, key]);
        if (map._start[1] === key) {
            var node = getLeafOrMulti(map._root, hash, key);
            var next = node.next;
            map._root = updatePosition(map._root, edit, [hash, key], undefined);
            map._root = updatePosition(map._root, edit, node.next, undefined, true);
            map._start = node.next;
        }
    }
    return map;
};

Map.prototype.append = function (key, value) {
    return appendHash(hash(key), key, value, false, this);
};

/**
    Store `value` for `key` in `map` using internal hash function.

    @see `setHash`
*/
const set = exports.set = (key, value, map) => setHash(map._config.hash(key), key, value, map);

Map.prototype.set = function (key, value) {
    return set(key, value, this);
};

/**
 * multi-map
 * - create an extra bucket for each entry with same key
 */
const addHash = exports.addHash = function (hash, key, value, map) {
    var insert = map._insert;
    var node = getLeafOrMulti(map._root, hash, key);
    var multi = node ? node.type == MULTI ? last(node.children).id + 1 : node.type == LEAF ? node.id + 1 : 0 : 0;
    var newmap = modifyHash(constant(value), hash, key, insert, multi, map);
    if (insert) {
        const edit = map._editable ? map._edit : NaN;
        newmap._root = updatePosition(newmap._root, edit, insert, [hash, key, multi]);
    }
    return newmap;
};

// single push, like arrays
Map.prototype.push = function (kv) {
    var key = kv[0],
        value = kv[1];
    return addHash(hash(key), key, value, this);
};

/**
    Remove the entry for `key` in `map`.

    Returns a map with the value removed. Does not alter `map`.
*/
const del = constant(nothing);
const removeHash = exports.removeHash = (hash, key, val, map) => {
    // in case of collision, we need a leaf
    var node = getLeafOrMulti(map._root, hash, key);
    if (node === undefined) return map;
    var prev = node.prev,
        next = node.next;
    var insert = map._insert;
    var leaf;
    if (node.type == MULTI) {
        // default: last will be removed
        leaf = val !== undefined ? getLeafFromMultiV(node, val) : last(node.children);
        prev = leaf.prev;
        next = leaf.next;
    }
    map = modifyHash(del, hash, key, null, leaf ? leaf.id : undefined, map);
    const edit = map._editable ? map._edit : NaN;
    var id = leaf ? leaf.id : 0;
    if (prev !== undefined) {
        map._root = updatePosition(map._root, edit, prev, next);
        if (insert && insert[1] === key && insert[2] === id) map._insert = prev;
    }
    if (next !== undefined) {
        map._root = updatePosition(map._root, edit, next, prev, true);
        if (map._start[1] === key && map._start[2] === id) {
            //next = node.next;
            map._root = updatePosition(map._root, edit, next, undefined, true);
            map._start = next;
        }
    }
    if (next === undefined && prev === undefined) {
        map._insert = map._start = undefined;
    }
    return map;
};

Map.prototype.removeHash = Map.prototype.deleteHash = function (hash, key) {
    return removeHash(hash, key, this);
};

/**
    Remove the entry for `key` in `map` using internal hash function.

    @see `removeHash`
*/
const remove = exports.remove = (key, map) => removeHash(map._config.hash(key), key, undefined, map);

Map.prototype.remove = Map.prototype.delete = function (key) {
    return remove(key, this);
};

// MULTI:
const removeValue = exports.removeValue = (key, val, map) => removeHash(map._config.hash(key), key, val, map);

Map.prototype.removeValue = Map.prototype.deleteValue = function (key, val) {
    return removeValue(key, val, this);
};
/* Mutation
 ******************************************************************************/
/**
    Mark `map` as mutable.
 */
const beginMutation = exports.beginMutation = map => new Map(map._editable + 1, map._edit + 1, map._config, map._root, map._size, map._start, map._insert);

Map.prototype.beginMutation = function () {
    return beginMutation(this);
};

/**
    Mark `map` as immutable.
 */
const endMutation = exports.endMutation = map => {
    map._editable = map._editable && map._editable - 1;
    return map;
};

Map.prototype.endMutation = function () {
    return endMutation(this);
};

/**
    Mutate `map` within the context of `f`.
    @param f
    @param map HAMT
*/
const mutate = exports.mutate = (f, map) => {
    const transient = beginMutation(map);
    f(transient);
    return endMutation(transient);
};

Map.prototype.mutate = function (f) {
    return mutate(f, this);
};

/* Traversal
 ******************************************************************************/
const DONE = {
    done: true
};

function MapIterator(root, v, f) {
    this.root = root;
    this.f = f;
    this.v = v;
}

MapIterator.prototype.next = function () {
    var v = this.v;
    if (!v) return DONE;
    var node = getLeafOrMulti(this.root, v[0], v[1]);
    if (node.type == MULTI) {
        node = getLeafFromMulti(node, v[2]);
        if (!node) return DONE;
    }
    this.v = node.next;
    return { value: this.f(node) };
};

MapIterator.prototype[Symbol.iterator] = function () {
    return this;
};

/**
    Lazily visit each value in map with function `f`.
*/
const visit = (map, f) => new MapIterator(map._root, map._start, f);

/**
    Get a Javascsript iterator of `map`.

    Iterates over `[key, value]` arrays.
*/
const buildPairs = x => [x.key, x.value];
const entries = exports.entries = map => visit(map, buildPairs);

Map.prototype.entries = Map.prototype[Symbol.iterator] = function () {
    return entries(this);
};

/**
    Get array of all keys in `map`.

    Order is not guaranteed.
*/
const buildKeys = x => x.key;
const keys = exports.keys = map => visit(map, buildKeys);

Map.prototype.keys = function () {
    return keys(this);
};

/**
    Get array of all values in `map`.

    Order is not guaranteed, duplicates are preserved.
*/
const buildValues = x => x.value;
const values = exports.values = Map.prototype.values = map => visit(map, buildValues);

Map.prototype.values = function () {
    return values(this);
};

/* Fold
 ******************************************************************************/
/**
    Visit every entry in the map, aggregating data.

    Order of nodes is not guaranteed.

    @param f Function mapping accumulated value, value, and key to new value.
    @param z Starting value.
    @param m HAMT
*/
const fold = exports.fold = (f, z, m) => {
    var root = m._root;
    if (isEmptyNode(root)) return z;
    var v = m._start;
    var node;
    do {
        node = getLeafOrMulti(root, v[0], v[1]);
        v = node.next;
        z = f(z, node.value, node.key);
    } while (node && node.next);
    return z;
};

Map.prototype.fold = Map.prototype.reduce = function (f, z) {
    return fold(f, z, this);
};

/**
    Visit every entry in the map, aggregating data.

    Order of nodes is not guaranteed.

    @param f Function invoked with value and key
    @param map HAMT
*/
const forEach = exports.forEach = (f, map) => fold((_, value, key) => f(value, key, map), null, map);

Map.prototype.forEach = function (f) {
    return forEach(f, this);
};

/* Aggregate
 ******************************************************************************/
/**
    Get the number of entries in `map`.
*/
const count = exports.count = map => map._size;

Map.prototype.count = function () {
    return count(this);
};

Object.defineProperty(Map.prototype, 'size', {
    get: Map.prototype.count
});