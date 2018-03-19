/* Copyright 2015 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the 'License');
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an 'AS IS' BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
module tf.graph {

/** Delimiter used in node names to denote namespaces. */
export const NAMESPACE_DELIM = '/';
export const NAMESPACE_EX = 'ex_';
export const NAMESPACE_DASH = '--';
export const ROOT_NAME = '__root__';
export const FUNCTION_LIBRARY_NODE = '__function_library__';

/** Attribute key used for storing attributes that are too large. */
export const LARGE_ATTRS_KEY = '_too_large_attrs';
/**
 * Maximum allowed size in bytes, before the attribute is considered large
 * and filtered out of the graph.
 */
export const LIMIT_ATTR_SIZE = 1024;

// Separator between the source and the destination name of the edge.
export const EDGE_KEY_DELIM = '--';

export enum GraphType {FULL, EMBEDDED, META, SERIES, CORE, SHADOW, BRIDGE,
    EDGE};
export enum NodeType {META, OP, SERIES, BRIDGE, ELLIPSIS};

/** Indicates if a node is to be included in the main graph when rendered. */
export enum InclusionType {INCLUDE, EXCLUDE, UNSPECIFIED};

/** Indicates if a series is to be grouped in the graph when rendered. */
export enum SeriesGroupingType {GROUP, UNGROUP};

/** Attribute key reserved for the shapes of the output tensors. */
const OUTPUT_SHAPES_KEY = '_output_shapes';

/** Attribute key reserved for the XLA cluster that an op runs on. */
const _XLA_CLUSTER_KEY = '_XlaCluster';

/**
 * A BaseEdge is the label object (in the graphlib sense) for an edge in the
 * original, full graph produced after parsing. Subsequent graphs, like those
 * which belong to Metanodes, should not use BaseEdge objects, but instead
 * contain Metaedges (which in turn may contain any number of BaseEdges).
 */
export interface BaseEdge extends graphlib.EdgeObject {
  isControlDependency: boolean;
  isReferenceEdge: boolean;
  /** The index of the output tensor of the source node. */
  outputTensorKey: string;
}

/**
 * A SlimGraph is inspired by graphlib.Graph, but having only the functionality
 * that we need.
 */
export class SlimGraph {
  nodes: { [nodeName: string]: OpNode };
  edges: BaseEdge[];

  constructor() {
    this.nodes = {};
    this.edges = [];
  }
}

export interface NormalizedInput {
  name: string;
  /** The index of the output tensor of the source node. */
  outputTensorKey: string;
  isControlDependency: boolean;
}

export interface BuildParams {
  enableEmbedding: boolean;
  inEmbeddingTypes: string[];
  outEmbeddingTypes: string[];
  refEdges: { [inputEdge: string]: boolean };
}

/**
 * The most basic information about a node in the hierarchical graph.
 */
export interface Node {
  /** The name of the node, used frequently to look up nodes by name. */
  name: string;
  /** Which type of node this is. */
  type: NodeType;
  /**
   * Whether this node is a type that may contain other nodes. Those types
   * should extend from GroupNode.
   *
   * For an OpNode, isGroupNode will be false, even though it may have
   * embeddings. These embedding Nodes will have their parentNode set to the
   * OpNode. However, embeddings are later rendered as annotations, not as
   * children to be made visible on expansion (like a Metanode or SeriesNode).
   */
  isGroupNode: boolean;
  /**
   * The number of nodes this node represents. For OpNodes, this will be 1, and
   * for GroupNodes it will be a count of the total number of descendents it
   * contains.
   */
  cardinality: number;
  /**
   * The Node which is this Node's parent. This is of type Node and not
   * GroupNode because of embeddings, which will have a parent OpNode.
   */
  parentNode: Node;
  /** Runtime execution stats for this node, if available */
  stats: NodeStats;
  /** If the node is to be included or excluded from the main graph when
   *  rendered. Defaults to UNSPECIFIED, which means that the rendering
   *  algorithm determines if it will be included or not. Then can be set to
   *  INCLUDE or EXCLUDE manually by the user.
   */
  include: InclusionType;
  /**
   * Node attributes specify customizable visual aspects of a node and
   * application-specific metadata associated with a node. The name
   * 'nodeAttributes' is meant to avoid naming-conflicts with the 'attr' in
   * subclasses of Node.
   */
  nodeAttributes: {[key: string]: any;};
}

export type TensorShape = number[];

export interface OpNode extends Node {
  op: string;
  // The device on which the op ran. Null if it is unknown.
  device: string;
  attr: {key: string, value: any}[];
  inputs: NormalizedInput[];
  inEmbeddings: OpNode[];
  outEmbeddings: OpNode[];
  // The name of the SeriesNode that can contain this node in its series.
  // If there is no such node, then this is null.
  owningSeries: string;
  /**
   * Object mapping output channel string to tensor shapes. The output channel
   * is a string rather than a number because within TensorFlow functions, an
   * output may be a cross between an output variable and a number (combined
   * with a colon) such as "foo:2" rather than just a number alone.
   *
   * Each tensor shape is an array of numbers, or null. Details:
   * - null means unknown rank, and therefore entire shape is unknown.
   * - [4, 2, 1] means rank-3 tensor of size 4x2x1.
   * - [] means a scalar (rank-0 tensor).
   * - [1] means rank-1 tensor of size 1 (not the same as scalar).
   * - [5, -1, 3] means rank-3 tensor of shape is 5x?x3. The size
   *       of the middle dimension is unknown (encoded as -1).
   */
  outputShapes: {[key: string]: TensorShape;};

  // The XLA Cluster on which the op ran. Null if it is unknown.
  xlaCluster: string;

  // Whether op is compatible with its assigned device.  Currently, if an op
  // is not specified a device, the device is defaulted to the TPU.
  // Furthermore, all ops are considered compatible for CPU and GPU devices,
  // while a whitelist of compatible ops are specifed for the TPU.
  // Reference: opValid func in op.ts.
  compatible: boolean;

  // This field is only defined if the op node represents an input_arg to a
  // library function. It is the index of the input_arg.
  functionInputIndex: number;

  // This field is only defined if the op node represents an output_arg of a
  // library function. It is the index of the output_arg.
  functionOutputIndex: number;
}

export interface BridgeNode extends Node {
  /**
   * Whether this bridge node represents edges coming into its parent node.
   */
  inbound: boolean;
}

/**
 * A node that is used when there are more than the maximum number of allowed
 * annotations hanging off of a node.  This node represents an ellipsis
 * annotation, indicating a number of additional annotations.
 */
export interface EllipsisNode extends Node {
  /**
   * The number of nodes this ellipsis represents.
   */
  numMoreNodes: number;

  /**
   * Sets the number of nodes this ellipsis represents and changes the node
   * name accordingly.
   */
  setNumMoreNodes(numNodes: number);
}

export interface GroupNode extends Node {
  /**
   * The metagraph contains nodes and metaedges between the immediate children
   * of this group. The node label objects may be other GroupNodes (like
   * SeriesNodes and Metanodes) or individual OpNodes. All edge label objects
   * are Metaedges, each of which contains references to the original
   * BaseEdge(s) from which it was created.
   */
  metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;

  /**
   * The bridgegraph contains only edges which link immediate children of this
   * group with nodes outside of the metagraph. As in the metagraph, all edge
   * label objects are Metaedges which contain references to the original
   * BaseEdge(s) that contribute to it.
   *
   * For a Metaedge in the bridgegraph, its external endpoint will be the same
   * as the metagraph edge from which it came. This is most easily explained
   * by example.
   *
   * Consider an original graph that contains a BaseEdge A/B/C->Z/Y/X.
   *
   *     +-------+    (BaseEdge)     +-------+
   *     | A/B/C |>----------------->| Z/Y/X |
   *     +-------+                   +-------+
   *
   * When we construct the Root's metagraph, it will contain nodes for A and Z,
   * and a Metaedge A->Z. The A->Z Metaedge will contain the original BaseEdge
   * A/B/C->Z/Y/X in its baseEdgeGraph. The Root's bridgegraph will always be
   * empty.
   *
   *     +---+    (Root.metagraph edge)    +---+
   *     | A |>--------------------------->| Z |
   *     +---+                             +---+
   *
   * Now consider the Metanode A. Its metagraph will contain a Metanode for A/B
   * and no edges. A's bridgegraph will have one Metaedge from A/B->Z, which
   * was derived from the Root's Metaedge A->Z. That Metaedge will contain the
   * original BaseEdge in its baseEdgeGraph.
   *
   *     +---------+
   *     | A       |
   *     |  +---+  |   (A.bridgegraph edge)    +---+
   *     |  | B |>---------------------------->| Z |
   *     |  +---+  |                           +---+
   *     +---------+
   *
   * Finally, consider the Metanode A/B. Its metagraph will contain a Metanode
   * for A/B/C and again no edges. A/B's bridgegraph will have one Metaedge
   * from A/B/C->Z, which was derived from A's bridgegraph Metaedge A/B->Z.
   * As before, the A/B/C->Z Metaedge will contain the original BaseEdge in its
   * baseEdgeGraph.
   *
   *     +---------------+
   *     | A             |
   *     |  +---------+  |
   *     |  | B       |  |
   *     |  |  +---+  |  |   (A/B.bridgegraph edge)      +---+
   *     |  |  | C |>----------------------------------->| Z |
   *     |  |  +---+  |  |                               +---+
   *     |  +---------+  |
   *     +---------------+
   *
   * Likewise, under the Metanode Z and Z/Y, to compute the bridgegraph, we'll
   * end up with Metaedges A->Z/Y and A->Z/Y/X respectively. So the original
   * BaseEdge A/B/C->Z/Y/X becomes four different Metaedges in four different
   * bridgegraphs:
   *
   *   + A/B->Z in GroupNode A's bridgegraph,
   *   + A/B/C->Z in GroupNode A/B's bridgegraph,
   *   + A->Z/Y in GroupNode Z's bridgegraph, and
   *   + A->Z/Y/X in GroupNode Z/Y's bridgegraph.
   *
   * Considering any BaseEdge then, if N is the number of path segments in the
   * source and M is the number of path segments in the destination, then the
   * total number of bridgegraph edges you could create would be (N-1)(M-1).
   *
   * For this reason, it is computationally expensive to generate all the
   * bridgegraphs for all the Metanodes, and instead they should be computed
   * on demand as needed.
   */
  bridgegraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;

  /**
   * Stores how many times each device name appears in its children
   * op nodes. Used to color group nodes by devices.
   */
  deviceHistogram: {[device: string]: number};

  /**
   * Stores how many ops in sub-graph were compatible and how many are
   * incompatible.
   */
  compatibilityHistogram: {compatible: number, incompatible: number}

  /**
   * Flag indicating whether this GroupNode's metagraph contains any edges that
   * are not control edges. Used to quickly determine how to draw a collapsed
   * series (vertically or horizontally).
   */
  hasNonControlEdges: boolean;
}

export interface Metanode extends GroupNode {
  depth: number;
  templateId: string;
  opHistogram: {[op: string]: number};
  getFirstChild(): GroupNode|OpNode;
  getRootOp(): OpNode;
  /** Return name of all leaves inside a metanode. */
  leaves(): string[];
}

export interface SeriesNode extends GroupNode {
  hasLoop: boolean;
  prefix: string;
  suffix: string;
  clusterId: number;
  ids: number[];
  parent: string;
}

export class EllipsisNodeImpl implements EllipsisNode {
  name: string;
  numMoreNodes: number;
  stats: NodeStats;
  type: NodeType;
  isGroupNode: boolean;
  cardinality: number;
  parentNode: Node;
  include: InclusionType;
  nodeAttributes: {[key: string]: any;};
  /**
   * Constructs a new ellipsis annotation node.
   *
   * @param numNodes The number of additional annotations this node represents.
   */
  constructor(numNodes: number) {
    this.type = NodeType.ELLIPSIS;
    this.isGroupNode = false;
    this.cardinality = 1;
    this.parentNode = null;
    this.stats = null;
    this.setNumMoreNodes(numNodes);
    this.include = InclusionType.UNSPECIFIED;
  }

  setNumMoreNodes(numNodes: number) {
    this.numMoreNodes = numNodes;
    this.name = '... ' + numNodes + ' more';
  }
};

/**
 * A label object for nodes in the full graph and leaf nodes in the render
 * graph.
 */
export class OpNodeImpl implements OpNode {
  name: string;
  op: string;
  device: string;
  stats: NodeStats;
  attr: {key: string, value: any}[];
  inputs: NormalizedInput[];
  type: NodeType;
  isGroupNode: boolean;
  cardinality: number;
  inEmbeddings: OpNode[];
  outEmbeddings: OpNode[];
  parentNode: Node;
  include: InclusionType;
  owningSeries: string;
  outputShapes: {[key: string]: TensorShape;};
  nodeAttributes: {[key: string]: any;};
  xlaCluster: string;
  compatible: boolean;

  // This field is only defined if the op node represents an input_arg to a
  // library function. It is the index of the input_arg.
  functionInputIndex: number;
  
  // This field is only defined if the op node represents an output_arg of a
  // library function. It is the index of the output_arg.
  functionOutputIndex: number;

  /**
   * Constructs a new Op node.
   *
   * @param rawNode The raw node.
   */
  constructor(rawNode: tf.graph.proto.NodeDef) {
    this.op = rawNode.op;
    this.name = rawNode.name;
    this.device = rawNode.device;
    this.attr = rawNode.attr;
    // An array of normalized inputs that denote the incoming edges to
    // the current node. Each input contains the normalized name of the
    // source node, whether it has a number part and whether it is a
    // control dependency.
    this.inputs = normalizeInputs(rawNode.input);
    this.outputShapes = extractOutputShapes(rawNode.attr);
    this.xlaCluster = extractXlaCluster(rawNode.attr);
    this.compatible = false;
    // additional properties
    this.type = NodeType.OP;
    this.isGroupNode = false;
    this.cardinality = 1;
    this.inEmbeddings = [];
    this.outEmbeddings = [];
    this.parentNode = null;
    this.include = InclusionType.UNSPECIFIED;
    this.owningSeries = null;
  }
};

export function createMetanode(name: string, opt = {}): Metanode {
  return new MetanodeImpl(name, opt);
}

/**
 * Joins the information from the stats file (memory, compute time) with the
 * graph information.
 */
export function joinStatsInfoWithGraph(
    graph: SlimGraph, stats: tf.graph.proto.StepStats,
    devicesForStats?: {[device: string]: boolean}): void {
  // Reset stats for each node.
  _.each(graph.nodes, node => { node.stats = null; });

  _.each(stats.dev_stats, devStats => {
    // Ignore devices that are not selected.
    if (devicesForStats && !devicesForStats[devStats.device]) {
      return;
    }
    _.each(devStats.node_stats, nodeStats => {
      // Lookup the node in the graph by its original name, e.g. A/B. If not
      // found, lookup by the rewritten name A/B/(B) in case the name is both
      // a namespace and a node name.
      let nodeName = nodeStats.node_name in graph.nodes ?
          nodeStats.node_name :
          getStrictName(nodeStats.node_name);

      // Couldn't find a matching node.
      if (!(nodeName in graph.nodes)) {
        return;
      }

      // Compute the total bytes used.
      let totalBytes = 0;
      if (nodeStats.memory) {
        _.each(nodeStats.memory, alloc => {
        if (alloc.total_bytes) {
            if (alloc.total_bytes > 0) {
              totalBytes += Number(alloc.total_bytes);
            } else {
              /* tslint:disable */
              console.log(
                  'ignoring negative memory allocation for ' + nodeName);
              /* tslint:enable */
            }
          }
        });
      }
      let outputSize: number[][] = null;
      if (nodeStats.output) {
        outputSize = _.map(nodeStats.output, output => {
          return _.map(output.tensor_description.shape.dim,
              dim => Number(dim.size));
        });
      }
      graph.nodes[nodeName].device = devStats.device;
      if (graph.nodes[nodeName].stats == null) {
        graph.nodes[nodeName].stats = new NodeStats(outputSize);
      }
      graph.nodes[nodeName].stats.addBytesAllocation(totalBytes);
      if (nodeStats.all_end_rel_micros) {
        if (nodeStats.all_end_rel_micros > 0) {
          graph.nodes[nodeName].stats.addExecutionTime(
              nodeStats.all_start_micros,
              nodeStats.all_start_micros + nodeStats.all_end_rel_micros);
        } else {
          /* tslint:disable */
          console.log('ignoring negative runtime for ' + nodeName);
          /* tslint:enable */
        }
      }
    });
  });
}

/**
 * Execution stats for the node.
 */
export class NodeStats {
  constructor(outputSize: number[][]) { this.outputSize = outputSize; }

  /**
   * Add the start and end time for a particular kernel execution of this op.
   * Ops can have multiple kernel executions within the same session run.
   */
  addExecutionTime(startTime: number, endTime: number) {
    if (this.startTime != null) {
      this.startTime = Math.min(this.startTime, startTime);
    } else {
      this.startTime = startTime;
    }
    if (this.endTime != null) {
      this.endTime = Math.max(this.endTime, endTime);
    } else {
      this.endTime = endTime;
    }
  }

  /**
   * Add the bytes allocated for a particular kernel execution of this op.
   * Ops can have multiple kernel executions within the same session run.
   */
  addBytesAllocation(totalBytes: number) {
    if (this.totalBytes != null) {
      this.totalBytes = Math.max(this.totalBytes, totalBytes);
    } else {
      this.totalBytes = totalBytes;
    }
  }

  /**
   * Absolute start time for the very first kernel execution of this op.
   */
  startTime: number;
  /**
   * Absolute end time for the very last kernel execution of this op.
   */
  endTime: number;
  /**
   * Total number of bytes used for the node. Sum of all children
   * if it is a Group node.
   */
  totalBytes = 0;

  /**
   * The shape of each output tensors, if there are any.
   * Empty if it is a Group node.
   */
  outputSize: number[][];

  /**
   * Combines the specified stats with the current stats.
   * Modifies the current object. This method is used to
   * compute aggregate stats for group nodes.
   */
  combine(stats: NodeStats): void {
    if (stats.totalBytes != null) {
      this.totalBytes += stats.totalBytes;
    }
    if (stats.getTotalMicros() != null) {
      this.addExecutionTime(stats.startTime, stats.endTime);
    }
  }

  /**
   * Total number of compute time in microseconds used for the node.
   * Sum of all children if it is a Group node. Null if it is unknown.
   * This method can not be scaffolded under a getter attribute because
   * ECMAScript 5 does not support getter attributes.
   */
  getTotalMicros(): number {
    if (this.startTime == null || this.endTime == null) {
      return null;
    }
    return this.endTime - this.startTime;
  }
}

export class MetanodeImpl implements Metanode {
  name: string;
  stats: NodeStats;
  type: NodeType;
  depth: number;
  isGroupNode: boolean;
  cardinality: number;
  metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;
  bridgegraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;
  templateId: string;
  opHistogram: {[op: string]: number};
  deviceHistogram: {[op: string]: number};
  compatibilityHistogram: {compatible: number, incompatible: number};
  parentNode: Node;
  hasNonControlEdges: boolean;
  include: InclusionType;
  nodeAttributes: {[key: string]: any;};

  /** A label object for meta-nodes in the graph hierarchy */
  constructor(name: string, opt = {}) {
    this.name = name;
    this.type = NodeType.META;
    /** number of levels under this group */
    this.depth = 1;
    this.isGroupNode = true;
    /** # of leaf nodes (including embedded ones) */
    this.cardinality = 0;
    /** graph contains metanodes, nodes, edges
     * and metaedges for main items within this metanode
     */
    this.metagraph =
      createGraph<GroupNode|OpNode, Metaedge>(name, GraphType.META, opt);
    /** bridgegraph must be constructed lazily-see hierarchy.getBridgegraph() */
    this.bridgegraph = null;
    /**
     * A dictionary that count ops type of nodes in this metanode
     * (op type => count).
     */
    this.opHistogram = {};
    this.deviceHistogram = {};
    this.compatibilityHistogram = {compatible: 0, incompatible: 0};
    /** unique id for a metanode of similar subgraph */
    this.templateId = null;
    /** Metanode which contains this node, if any */
    this.parentNode = null;
    this.hasNonControlEdges = false;
    this.include = InclusionType.UNSPECIFIED;
  }

  getFirstChild(): GroupNode|OpNode {
    return this.metagraph.node(this.metagraph.nodes()[0]);
  }

  /**
   * Returns the op node associated with the metanode.
   * For example, if the metanode is 'sgd', the associated
   * op node is sgd/(sgd).
   */
  getRootOp(): OpNode {
    let nameSplit = this.name.split('/');
    let rootOpName = this.name + '/(' + nameSplit[nameSplit.length - 1] + ')';
    return <OpNode>this.metagraph.node(rootOpName);
  }

  /**
   * Return an array of the names of all the leaves (non-GroupNodes) inside
   * this metanode. This performs a breadth-first search of the tree, so
   * immediate child leaves will appear earlier in the output array than
   * descendant leaves.
   */
  leaves(): string[] {
    let leaves = [];
    let queue = [<Node> this];
    let metagraph; // Defined here due to a limitation of ES6->5 compilation.
    while (queue.length) {
      let node = queue.shift();
      if (node.isGroupNode) {
        metagraph = (<GroupNode> node).metagraph;
        _.each(metagraph.nodes(), name => queue.push(metagraph.node(name)));
      } else {
        leaves.push(node.name);
      }
    }
    return leaves;
  }
};

export interface Metaedge extends graphlib.EdgeObject {

  /**
   * Stores the original BaseEdges represented by this Metaedge.
   */
  baseEdgeList: BaseEdge[];

  /**
   * Whether this edge represents a relationship that is inbound (or outbound)
   * to the object which contains this information. For example, in a Metanode's
   * bridgegraph, each edge connects an immediate child to something outside
   * the Metanode. If the destination of the edge is inside the Metanode, then
   * its inbound property should be true. If the destination is outside the
   * Metanode, then its inbound property should be false.
   *
   * The property is optional because not all edges can be described as
   * inbound/outbound. For example, in a Metanode's metagraph, all of the edges
   * connect immediate children of the Metanode. None should have an inbound
   * property, or they should be null/undefined.
   */
  inbound?: boolean;

  /**
   * Number of regular edges (not control dependency edges).
   */
  numRegularEdges: number;

  /**
   * Number of control dependency edges.
   */
  numControlEdges: number;

  /**
   * Number of reference edges, which is an edge to an operation
   * that takes a reference to its input and changes its value.
   */
  numRefEdges: number;

  /**
   * Total size (number of units) of all the tensors flowing through this edge.
   */
  totalSize: number;

  addBaseEdge(edge: BaseEdge, h: hierarchy.Hierarchy): void;
}

export function createMetaedge(v: string, w: string): Metaedge {
  return new MetaedgeImpl(v, w);
}

/**
 * A label object for edges between metanodes of subgraphs in the render graph.
 */
export class MetaedgeImpl implements Metaedge {
  v: string;
  w: string;
  baseEdgeList: BaseEdge[];
  inbound: boolean;
  numRegularEdges: number;
  numControlEdges: number;
  numRefEdges: number;
  totalSize: number;

  constructor(v: string, w: string) {
    this.v = v;
    this.w = w;
    this.baseEdgeList = [];
    this.inbound = null;
    this.numRegularEdges = 0;
    this.numControlEdges = 0;
    this.numRefEdges = 0;
    this.totalSize = 0;
  }

  addBaseEdge(edge: BaseEdge, h: hierarchy.Hierarchy): void {
    this.baseEdgeList.push(edge);
    if (edge.isControlDependency) {
      this.numControlEdges += 1;
    } else {
      this.numRegularEdges += 1;
    }
    if (edge.isReferenceEdge) {
      this.numRefEdges += 1;
    }
    // Compute the size of the tensor flowing through this
    // base edge.
    this.totalSize += MetaedgeImpl.computeSizeOfEdge(edge, h);
    h.maxMetaEdgeSize = Math.max(h.maxMetaEdgeSize, this.totalSize);
  }

  private static computeSizeOfEdge(edge: BaseEdge, h: hierarchy.Hierarchy):
      number {
    let opNode = <OpNode> h.node(edge.v);
    if (!opNode.outputShapes) {
      // No shape information. Asssume a single number. This gives
      // a lower bound for the total size.
      return 1;
    }
    h.hasShapeInfo = true;

    // Sum the sizes of all output tensors.
    return _(opNode.outputShapes).mapValues((shape: number[]) => {
      // If the shape is unknown, treat it as 1 when computing
      // total size. This gives a lower bound for the total size.
      if (shape == null) {
        return 1;
      }
      // Multiply all shapes to get the total size of the tensor.
      // E.g. The total size of [4, 2, 1] is 4 * 2 * 1.
      return _(shape).reduce((accumulated, currSize) => {
        // If this particular dimension is unknown, treat
        // it as 1 when computing total size. This gives a lower bound
        // for the total size.
        if (currSize === -1) {
          currSize = 1;
        }
        return accumulated * currSize;
      }, 1);
    }).sum();
  }
}

export function createSeriesNode(prefix: string, suffix: string,
    parent: string, clusterId: number, name: string): SeriesNode {
  return new SeriesNodeImpl(prefix, suffix, parent, clusterId, name);
}

export function getSeriesNodeName(prefix: string, suffix: string,
    parent: string, startId?: number, endId?: number): string {
  let numRepresentation =
      (typeof startId !== 'undefined' && typeof endId !== 'undefined') ?
      '[' + startId + '-' + endId + ']' :
      '#';
  let pattern = prefix + numRepresentation + suffix;
  return (parent ? parent + '/' : '') + pattern;
}

class SeriesNodeImpl implements SeriesNode {
  name: string;
  type: NodeType;
  stats: NodeStats;
  hasLoop: boolean;
  prefix: string;
  suffix: string;
  clusterId: number;
  ids: number[];
  parent: string;
  isGroupNode: boolean;
  cardinality: number;
  metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;
  bridgegraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;
  parentNode: Node;
  deviceHistogram: {[op: string]: number};
  compatibilityHistogram: {compatible: number, incompatible: number};
  hasNonControlEdges: boolean;
  include: InclusionType;
  nodeAttributes: {[key: string]: any;};

  constructor(prefix: string, suffix: string, parent: string,
      clusterId: number, name: string) {
    this.name = name || getSeriesNodeName(prefix, suffix, parent);
    this.type = NodeType.SERIES;
    this.hasLoop = false;
    this.prefix = prefix;
    this.suffix = suffix;
    this.clusterId = clusterId;
    this.ids = [];
    this.parent = parent;
    this.isGroupNode = true;
    this.cardinality = 0;
    this.metagraph = createGraph<Metanode, Metaedge>(name, GraphType.SERIES);
    // bridgegraph must be constructed lazily-see hierarchy.getBridgegraph()
    this.bridgegraph = null;
    this.parentNode = null;
    this.deviceHistogram = {};
    this.compatibilityHistogram = {compatible: 0, incompatible: 0};
    this.hasNonControlEdges = false;
    this.include = InclusionType.UNSPECIFIED;
  }
}

/**
 * Extracts the shapes of the output tensors from the attr property in the
 * node proto.
 */
// tslint:disable-next-line:no-any
function extractOutputShapes(attr: Array<{key: string, value: any}>):
    {[key: string]: TensorShape;} {
  let result = null;
  // We don't know anything about the output tensors.
  if (!attr) {
    return null;
  }
  for (let i = 0; i < attr.length; i++) {
    let {key, value} = attr[i];
    if (key === OUTPUT_SHAPES_KEY) {
      if (!value.list.shape) {
        // The OUTPUT_SHAPES_KEY lacks a value. We know nothing about the shape.
        return null;
      }

      // Map all output tensors into array of numbers denoting their shape.
      let result = value.list.shape.map(shape => {
        if (shape.unknown_rank) {
          // This output tensor is of unknown rank. We don't know if it is a
          // scalar, or a tensor, or of what shape it is.
          return null;
        }
        if (shape.dim == null ||
            (shape.dim.length === 1 && shape.dim[0].size == null)) {
          // This output tensor is a scalar.
          return [];
        }
        // This output tensor has a known rank. Map each dimension size
        // into a number.
        return shape.dim.map(dim => {
          // Size can be -1 if this particular dimension is unknown.
          return dim.size;
        });
      });
      // Since we already processed it, remove the entry from the attribute
      // list (saves memory).
      attr.splice(i, 1);
      return result;
    }
  }
  // We didn't find OUTPUT_SHAPES_KEY in attributes, so we don't know anything
  // about the output tensors.
  return null;
}

/**
 * Extracts the XLA Cluster that an op runs on from the attrs of the OpNode.
 * @param attr The attr property.
 * @return A string that is the name of the cluster. Or null if it could not be
 *     determined.
 */
// tslint:disable-next-line:no-any
function extractXlaCluster(attr: Array<{key: string, value: any}>): string|
    null {
  if (!attr) {
    return null;
  }

  // Find the attribute for XLA cluster if there is one.
  for (let i = 0; i < attr.length; i++) {
    if (attr[i].key === _XLA_CLUSTER_KEY) {
      return attr[i].value['s'] || null;
    }
  }
  return null;
}

/**
 * Normalizes the inputs and extracts associated metadata:
 * 1) Inputs can contain a colon followed by a suffix of characters.
 *    That suffix may be a single number (e.g. inputName:1) or several word
 *    characters separated from a number by a colon (e.g. inputName:foo:1). The
 *    latter case is used to denote inputs and outputs of functions.
 * 2) Control dependency inputs contain caret at the beginning and we
 *    remove this and annotate the edge as a control dependency.
 * @param inputs Array of unnormalized names of input nodes.
 */
function normalizeInputs(inputs: string[]): NormalizedInput[] {
  let normalizedInputs: NormalizedInput[] = [];
  _.each(inputs, inputName => {
    let isControlDependency = inputName[0] === '^';
    if (isControlDependency) {
      // The carat merely indicates whether this input is a control dependency.
      // It should not be part of the name.
      inputName = inputName.substring(1);
    }

    let name = inputName;
    let outputTensorKey = '0';

    let match = inputName.match(/(.*):(\w+:\d+)$/);
    if (match) {
      // The output string consists of several characters and a number separated
      // by a colon.
      name = match[1];
      outputTensorKey = match[2];
    } else {
      match = inputName.match(/(.*):(\d+)$/);
      if (match) {
        // The output string consists of a single number.
        name = match[1];
        outputTensorKey = match[2];
      }
    }

    if (normalizedInputs.length === 0 ||
      name !== normalizedInputs[normalizedInputs.length - 1].name) {
      normalizedInputs.push({
        name: name,
        outputTensorKey: outputTensorKey,
        isControlDependency: isControlDependency,
      });
    }
  });
  return normalizedInputs;
}

function addEdgeToGraph(
    graph: SlimGraph, inputName: string, outputNode: OpNode,
    input: NormalizedInput, params: BuildParams, index: number) {
  // Don't allow loops in the graph.
  if (inputName === outputNode.name) {
    return;
  }
  // Check if this op type and input number corresponds to a
  // reference edge using the refEdges dictionary in the params.
  let isRefEdge = params.refEdges[outputNode.op + ' ' + index] === true;
  graph.edges.push({
    v: inputName,
    w: outputNode.name,
    outputTensorKey: input.outputTensorKey,
    isControlDependency: input.isControlDependency,
    isReferenceEdge: isRefEdge
  });
}

// minhs
export interface relAttr {
  key: string,
  value: string
}

function rawNodeGenerator() {
  let rawNodesgene = [];

  function createRaw(Data) {

    // pick only Entity, Activity, and Agent
    let pickEntity = _.pick(Data, ["entity"]);
    let pickActivity = _.pick(Data, ["activity"]);
    let pickAgent = _.pick(Data, ["agent"]);

    // filter and get the key of the object, then return the array with keys
    let procEntity = _.keys(pickEntity["entity"]);
    let procActivity = _.keys(pickActivity["activity"]);
    let procAgent = _.keys(pickAgent["agent"]);

    // omit all unnecessary keys to return all relations
    let pickData = _.omit(Data, ["entity", "activity", "agent", "prefix"]);

    console.log(pickData,' pickData');

    let procElemT = [];
    // refined data into [{head:.., tail:.., relation:..}, {}, ..]
    Object.keys(pickData).forEach(function(key) {
      let elem = _.values(pickData[key]);
      for (let l = 0; l < elem.length; l++) {
        elem[l]["relation"] = key;
        // compare the key to modify head and tail
        Object.keys(elem[l]).forEach(function(k) {
          /** PROV-DM Relations
           * Formation: relation = head + tail
           * Entity - Entity --------------------------------------------
           * wasDerivedFrom   = prov:generatedEntity + prov:usedEntity
           * Revision
           * Quotation
           * PrimarySource
           * alternateOf      = prov:alternate2      + prov:alternate1
           * specializationOf = prov:specificEntity  + prov:generalEntity
           * hadMember
           * Activity - Activity ----------------------------------------
           * wasInformedBy    = 
           * Agent - Agent ----------------------------------------------
           * actedOnBehalfOf  = prov:delegate        + prov:responsible
           */
          if (key == "wasDerivedFrom" || key == "alternateOf" || key == "specializationOf" || key == "actedOnBehalfOf") {
            if (k == "prov:generatedEntity" || k == "prov:alternate2" || k == "prov:specificEntity" || k == "prov:delegate") {
              elem[l]['head'] = elem[l][k];
              delete elem[l][k];
            }
            if (k == "prov:usedEntity" || k == "prov:alternate1" || k == "prov:generalEntity" || k == "prov:responsible") {
              elem[l]['tail'] = elem[l][k];
              delete elem[l][k];
            }
            if (k == "prov:activity") {
              elem[l]['second_tail'] = elem[l][k];
              delete elem[l][k];
            }
          } 
          /* Activity - Entity ------------------------------------------
           * used
           * wasStartedBy
           * wasEndedBy
           */ 
          else if (key == "used" || key == "wasStartedBy" || key == "wasEndedBy") {
            if (k == "prov:activity") {
              elem[l]['head'] = elem[l][k];
              delete elem[l][k];
            }
            if (k == "prov:entity") {
              elem[l]['tail'] = elem[l][k];
              delete elem[l][k];
            }
            if (k == "prov:starter" || k == "prov:ender") {
              elem[l]['second_tail'] = elem[l][k];
              delete elem[l][k];
            }
          } 
          /* Entity - Activity ------------------------------------------
           * wasGeneratedBy
           * wasInvalidatedBy
           */ 
          else if (key == "wasGeneratedBy" || key == "wasInvalidatedBy") {
            if (k == "prov:entity") {
              elem[l]['head'] = elem[l][k];
              delete elem[l][k];
            }
            if (k == "prov:activity") {
              elem[l]['tail'] = elem[l][k];
              delete elem[l][k];
            }
          } 
          /* Entity - Agent ---------------------------------------------
           * wasAttributedTo
           */ 
          else if (key == "wasAttributedTo") {
            if (k == "prov:entity") {
              elem[l]['head'] = elem[l][k];
              delete elem[l][k];
            }
            if (k == "prov:agent") {
              elem[l]['tail'] = elem[l][k];
              delete elem[l][k];
            }
          } 
          /* Activity - Agent -------------------------------------------
           * wasAssociatedWith
           */ 
          else if (key == "wasAssociatedWith") {
            if (k == "prov:activity") {
              elem[l]['head'] = elem[l][k];
              delete elem[l][k];
            }
            if (k == "prov:agent") {
              elem[l]['tail'] = elem[l][k];
              delete elem[l][k];
            }
            if (k == "prov:plan") {
              elem[l]['second_tail'] = elem[l][k];
              delete elem[l][k];
            }
          }
        });
      }
      procElemT.push(elem);
    });
    // concat/combine arrays in array
    let procElem = [].concat.apply([], procElemT);
    console.log(procElem,' procElem');

    function secondTailInput(x) {
      let splitSecondTail = procElem[x].second_tail.split(':');
      // push data into input element
      objData["input"].push(splitSecondTail[0] + NAMESPACE_DELIM + NAMESPACE_EX + splitSecondTail[1]);
      // there will be no attr (label) for split edges
    }

    function createInputAttr(x) {
      let splitHead = procElem[x].head.split(':');
      let splitTail = procElem[x].tail.split(':');
      // Check if has second tail
      if (procElem[x].second_tail) {
        secondTailInput(x);
      } else {
        // push data into input and attr element
        objData["input"].push(splitHead[0] + NAMESPACE_DELIM + splitHead[1]);
        attrVal.key = splitHead[0] + NAMESPACE_DELIM + splitHead[1] + NAMESPACE_DASH + splitTail[0] + NAMESPACE_DELIM + splitTail[1];
        attrVal.value = procElem[x].relation;
        objData.attr.push(attrVal);
        attrVal = {} as relAttr;
      }
    }

    // push data into each Entity, Activity, Agent, and Extra Nodes
    let objData = {} as OpNode;
    let attrVal = {} as relAttr;
    // Entity
    for (let i = 0; i < procEntity.length; i++) {
      let splitData = procEntity[i].split(':');
      objData.name = splitData[0] + NAMESPACE_DELIM + splitData[1];
      objData.op = "entity";
      objData.attr = [];
      objData["input"] = [];
      for (let x = 0; x < procElem.length; x++) {
        // Check if has one or two tails
        if (procElem[x].tail == procEntity[i]) {
          createInputAttr(x);
        } else if (procElem[x].second_tail == procEntity[i]) {
          secondTailInput(x);
        }
      }
      rawNodesgene.push(objData);
      objData = {} as OpNode;
    }
    // Activity
    for (let i = 0; i < procActivity.length; i++) {
      let splitData = procActivity[i].split(':');
      objData.name = splitData[0] + NAMESPACE_DELIM + splitData[1];
      objData.op = "activity";
      objData.attr = [];
      objData["input"] = [];
      for (let x = 0; x < procElem.length; x++) {
        // Check if has one or two tails
        if (procElem[x].tail == procActivity[i]) {
          createInputAttr(x);
        } else if (procElem[x].second_tail == procActivity[i]) {
          secondTailInput(x);
        }
      }
      rawNodesgene.push(objData);
      objData = {} as OpNode;
    }
    // Agent
    for (let i = 0; i < procAgent.length; i++) {
      let splitData = procAgent[i].split(':');
      objData.name = splitData[0] + NAMESPACE_DELIM + splitData[1];
      objData.op = "agent";
      objData.attr = [];
      objData["input"] = [];
      for (let x = 0; x < procElem.length; x++) {
        // Check if has one or two tails
        if (procElem[x].tail == procAgent[i]) {
          createInputAttr(x);
        } else if (procElem[x].second_tail == procAgent[i]) {
          secondTailInput(x);
        }
      }
      rawNodesgene.push(objData);
      objData = {} as OpNode;
    }
    // Extra Nodes
    for (let e = 0; e < procElem.length; e++) {
      if (procElem[e].second_tail) {
        let splitSecondTail = procElem[e].second_tail.split(':');
        let splitHead = procElem[e].head.split(':');
        objData.name = splitSecondTail[0] + NAMESPACE_DELIM + NAMESPACE_EX + splitSecondTail[1];
        objData.op = "ex";
        objData.attr = [];
        objData["input"] = [];
        // push data into input and attr element
        objData["input"].push(splitHead[0] + NAMESPACE_DELIM + splitHead[1]);
        attrVal.key = splitHead[0] + NAMESPACE_DELIM + splitHead[1] + NAMESPACE_DASH + objData.name;
        attrVal.value = procElem[e].relation;
        objData.attr.push(attrVal);
        attrVal = {} as relAttr;

        rawNodesgene.push(objData);
        objData = {} as OpNode;
      }
    }
  }
  
  function processData(errors, Data) {
    if (errors) throw errors;
    console.log(Data,' Data');
    createRaw(Data);
  }
  
  d3.queue()
      // .defer(d3.json, "https://raw.githubusercontent.com/minhnaru/tensorboard/master/data/data1.json")
      .defer(d3.json, "https://raw.githubusercontent.com/minhnaru/tensorboard/master/data/data2.json")
      // .defer(d3.json, "https://raw.githubusercontent.com/minhnaru/tensorboard/master/data/data3.json")

      // Some random data
      // .defer(d3.json, "https://raw.githubusercontent.com/minhnaru/tensorboard/master/data/data4.json")
      // .defer(d3.json, "https://raw.githubusercontent.com/minhnaru/tensorboard/master/data/data5.json")
      // .defer(d3.json, "https://raw.githubusercontent.com/minhnaru/tensorboard/master/data/data6.json")
      .await(processData);

  console.log(rawNodesgene,' rawNodesgene');

  return rawNodesgene;
}
// end minh

export function build(
    graphDef: tf.graph.proto.GraphDef, params: BuildParams,
    tracker: ProgressTracker): Promise<SlimGraph|void> {
  /**
   * A dictionary that maps each in-embedding node name to the node
   * object.
   */
  let inEmbedding: {[nodeName: string]: OpNode} = {};
  /**
   * A dictionary that maps each out-embedding node name to the node
   * object.
   */
  let outEmbedding: {[nodeName: string]: OpNode} = {};
  /**
   * A dictionary that maps each node name to an array of the node's
   * out-embedding node label objects.
   */
  let outEmbeddings: {[inputName: string]: OpNode[]} = {};
  let isInEmbeddedPred = getEmbedPredicate(params.inEmbeddingTypes);
  let isOutEmbeddedPred = getEmbedPredicate(params.outEmbeddingTypes);
  let embeddingNodeNames: string[] = [];
  // original
  // let rawNodes = graphDef.node;

  // minh
  let rawNodes = rawNodeGenerator();

  // Main with Nest
  /* let rawNodes = [
    // {
    //   "name":"init",
    //   "op":"NoOp",
    //   // "input": [
    //   //   "recipes/bake",
    //   //   "products/cake"
    //   // ],
    //   // "attr": []
    // },
    {
      "name":"recipes/combine",
      "op":"activity",
      "input": [
        "recipes/ex_combine"
      ],
      "attr": []
    },
    {
      "name":"recipes/prepare",
      "op":"activity",
      "input": [
        "recipes/ex_prepare"
      ],
      "attr": []
    },
    {
      "name":"staff/instructions",
      "op":"entity",
      "input": [
        "staff/ex_instructions"
      ],
      "attr": []
    },
    {
      "name":"recipes/ex_combine",
      "op":"ex",
      "input": [
        "products/cake"
      ],
      "attr": [
        {
          "key":"products/cake--recipes/ex_combine",
          "value":"wasDerivedFrom"
        }
      ]
    },
    {
      "name":"recipes/ex_prepare",
      "op":"ex",
      "input": [
        "products/cake"
      ],
      "attr": [
        {
          "key":"products/cake--recipes/ex_prepare",
          "value":"wasDerivedFrom"
        }
      ]
    },
    {
      "name":"staff/ex_instructions",
      "op":"ex",
      "input": [
        "recipes/bake"
      ],
      "attr": [
        {
          "key":"recipes/bake--staff/ex_instructions",
          "value":"wasAssociatedWith"
        }
      ]
    },
    {
      "name":"recipes/bake",
      "op":"activity",
      "input":[
        "products/cake",
        "recipes/nutela"
      ],
      "attr":[  
        {  
          "key":"products/cake--recipes/bake", // head--tail
          "value":"wasGenereatedBy"
        }
      ]
    },
    {
      "name":"products/cake",
      "op":"entity",
      "attr":[]
    },
    {
      "name":"recipes/spices",
      "op":"entity",
      "input":[
        "recipes/bake",
        // "products/cake"
        "recipes/ex_combine"
      ],
      "attr":[  
        {
          "key":"recipes/bake--recipes/spices",
          "value":"used"
        }
        // {
        //   "key":"products/cake--recipes/spices",
        //   "value":"wasDerivedFrom"
        // }
      ]
    },
    {
      "name":"recipes/ingredients",
      "op":"entity",
      "input":[
        "recipes/bake",
        // "products/cake"
        "recipes/ex_prepare"
      ],
      "attr":[  
        {
          "key":"recipes/bake--recipes/ingredients",
          "value":"used"
        },
        // {
        //   "key":"products/cake--recipes/ingredients",
        //   "value":"wasDerivedFrom"
        // }
      ]
    },
    {
      "name":"staff/chef",
      "op":"agent",
      "input":[
        // "recipes/bake",
        "staff/ex_instructions",
        "products/cake"
      ],
      "attr":[
        // {
        //   "key":"recipes/bake--staff/chef",
        //   "value":"wasAssociatedWith"
        // },
        {
          "key":"products/cake--staff/chef",
          "value":"wasAttributedTo"
        }
      ]
    }
  ]; */
  // console.log(rawNodes,' rawNodes');

  // Main w/o Nest
  /* let rawNodes = [
    {
      "name":"Recipes/bake",
      "op":"activity",
      "input":[
        "Recipes/cake"
      ],
      "attr":[  
        {  
          "key":"Recipes/cake--Recipes/bake", // start--end
          "value":"wasGenereatedBy"
        }
      ]
    },
    {
      "name":"Recipes/cake",
      "op":"entity",
      "attr":[]
    },
    {
      "name":"Recipes/ingredients",
      "op":"entity",
      "input":[
        "Recipes/bake",
        "Recipes/cake"
      ],
      "attr":[  
        {  
          "key":"Recipes/bake--Recipes/ingredients",
          "value":"used"
        },
        {  
          "key":"Recipes/cake--Recipes/ingredients",
          "value":"wasDerivedFrom"
        }
      ]
    },
    {
      "name":"Recipes/spices",
      "op":"entity",
      "input":[
        "Recipes/bake",
        "Recipes/cake"
      ],
      "attr":[  
        {  
          "key":"Recipes/bake--Recipes/spices",
          "value":"used"
        },
        {  
          "key":"Recipes/cake--Recipes/spices",
          "value":"wasRevisionOf"
        }
      ]
    },
    {
      "name":"Recipes/chef",
      "op":"agent",
      "input":[
        "Recipes/bake",
        "Recipes/cake"
      ],
      "attr":[
        {  
          "key":"Recipes/bake--Recipes/chef",
          "value":"wasAssociatedWith"
        },
        {  
          "key":"Recipes/cake--Recipes/chef",
          "value":"wasAttributedTo"
        }
      ]
    },
    {
      "name":"Recipes/chef2",
      "op":"agent",
      "input":[
        "Recipes/chef"
      ],
      "attr":[]
    }
  ]; */

  // Sample 1
  /* let rawNodes = [
    {
      "name": "InputData",
      "op": "Placeholder",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "shape",
          "value": {
            "shape": {
              "dim": [
                {
                  "size": -1
                },
                {
                  "size": 784
                }
              ]
            }
          }
        }
      ]
    },
    {
      "name": "LabelData",
      "op": "Placeholder",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "shape",
          "value": {
            "shape": {
              "dim": [
                {
                  "size": -1
                },
                {
                  "size": 10
                }
              ]
            }
          }
        }
      ]
    },
    {
      "name": "zeros",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_FLOAT",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 784
                  },
                  {
                    "size": 10
                  }
                ]
              },
              "float_val": 0
            }
          }
        }
      ]
    },
    {
      "name": "Weights",
      "op": "VariableV2",
      "attr": [
        {
          "key": "container",
          "value": {
            "s": ""
          }
        },
        {
          "key": "dtype",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "shape",
          "value": {
            "shape": {
              "dim": [
                {
                  "size": 784
                },
                {
                  "size": 10
                }
              ]
            }
          }
        },
        {
          "key": "shared_name",
          "value": {
            "s": ""
          }
        }
      ]
    },
    {
      "name": "Weights/Assign",
      "op": "Assign",
      "input": [
        "Weights",
        "zeros"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@Weights"
              ]
            }
          }
        },
        {
          "key": "use_locking",
          "value": {
            "b": true
          }
        },
        {
          "key": "validate_shape",
          "value": {
            "b": true
          }
        }
      ]
    },
    {
      "name": "Weights/read",
      "op": "Identity",
      "input": [
        "Weights"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@Weights"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "zeros_1",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_FLOAT",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 10
                  }
                ]
              },
              "float_val": 0
            }
          }
        }
      ]
    },
    {
      "name": "Bias",
      "op": "VariableV2",
      "attr": [
        {
          "key": "container",
          "value": {
            "s": ""
          }
        },
        {
          "key": "dtype",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "shape",
          "value": {
            "shape": {
              "dim": [
                {
                  "size": 10
                }
              ]
            }
          }
        },
        {
          "key": "shared_name",
          "value": {
            "s": ""
          }
        }
      ]
    },
    {
      "name": "Bias/Assign",
      "op": "Assign",
      "input": [
        "Bias",
        "zeros_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@Bias"
              ]
            }
          }
        },
        {
          "key": "use_locking",
          "value": {
            "b": true
          }
        },
        {
          "key": "validate_shape",
          "value": {
            "b": true
          }
        }
      ]
    },
    {
      "name": "Bias/read",
      "op": "Identity",
      "input": [
        "Bias"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@Bias"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "Model/MatMul",
      "op": "MatMul",
      "input": [
        "InputData",
        "Weights/read"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "transpose_a",
          "value": {
            "b": false
          }
        },
        {
          "key": "transpose_b",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "Model/add",
      "op": "Add",
      "input": [
        "Model/MatMul",
        "Bias/read"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "Model/Softmax",
      "op": "Softmax",
      "input": [
        "Model/add"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "Loss/Log",
      "op": "Log",
      "input": [
        "Model/Softmax"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "Loss/mul",
      "op": "Mul",
      "input": [
        "LabelData",
        "Loss/Log"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "Loss/Sum/reduction_indices",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {},
              "int_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "Loss/Sum",
      "op": "Sum",
      "input": [
        "Loss/mul",
        "Loss/Sum/reduction_indices"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "Loss/Neg",
      "op": "Neg",
      "input": [
        "Loss/Sum"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "Loss/Const",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 1
                  }
                ]
              },
              "int_val": 0
            }
          }
        }
      ]
    },
    {
      "name": "Loss/Mean",
      "op": "Mean",
      "input": [
        "Loss/Neg",
        "Loss/Const"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Shape",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {}
                ]
              }
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/grad_ys_0",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_FLOAT",
              "tensor_shape": {},
              "float_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Fill",
      "op": "Fill",
      "input": [
        "SGD/gradients/Shape",
        "SGD/gradients/grad_ys_0"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Reshape/shape",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 1
                  }
                ]
              },
              "int_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Reshape",
      "op": "Reshape",
      "input": [
        "SGD/gradients/Fill",
        "SGD/gradients/Loss/Mean_grad/Reshape/shape"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tshape",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Shape",
      "op": "Shape",
      "input": [
        "Loss/Neg"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "out_type",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Tile",
      "op": "Tile",
      "input": [
        "SGD/gradients/Loss/Mean_grad/Reshape",
        "SGD/gradients/Loss/Mean_grad/Shape"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tmultiples",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Shape_1",
      "op": "Shape",
      "input": [
        "Loss/Neg"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "out_type",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Shape_2",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {}
                ]
              }
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Const",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 1
                  }
                ]
              },
              "int_val": 0
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Prod",
      "op": "Prod",
      "input": [
        "SGD/gradients/Loss/Mean_grad/Shape_1",
        "SGD/gradients/Loss/Mean_grad/Const"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Const_1",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 1
                  }
                ]
              },
              "int_val": 0
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Prod_1",
      "op": "Prod",
      "input": [
        "SGD/gradients/Loss/Mean_grad/Shape_2",
        "SGD/gradients/Loss/Mean_grad/Const_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Maximum/y",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {},
              "int_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Maximum",
      "op": "Maximum",
      "input": [
        "SGD/gradients/Loss/Mean_grad/Prod_1",
        "SGD/gradients/Loss/Mean_grad/Maximum/y"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/floordiv",
      "op": "FloorDiv",
      "input": [
        "SGD/gradients/Loss/Mean_grad/Prod",
        "SGD/gradients/Loss/Mean_grad/Maximum"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/Cast",
      "op": "Cast",
      "input": [
        "SGD/gradients/Loss/Mean_grad/floordiv"
      ],
      "attr": [
        {
          "key": "DstT",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "SrcT",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Mean_grad/truediv",
      "op": "RealDiv",
      "input": [
        "SGD/gradients/Loss/Mean_grad/Tile",
        "SGD/gradients/Loss/Mean_grad/Cast"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Neg_grad/Neg",
      "op": "Neg",
      "input": [
        "SGD/gradients/Loss/Mean_grad/truediv"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/Shape",
      "op": "Shape",
      "input": [
        "Loss/mul"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "out_type",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/Size",
      "op": "Const",
      "attr": [
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        },
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {},
              "int_val": 2
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/add",
      "op": "Add",
      "input": [
        "Loss/Sum/reduction_indices",
        "SGD/gradients/Loss/Sum_grad/Size"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/mod",
      "op": "FloorMod",
      "input": [
        "SGD/gradients/Loss/Sum_grad/add",
        "SGD/gradients/Loss/Sum_grad/Size"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/Shape_1",
      "op": "Const",
      "attr": [
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        },
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {}
                ]
              }
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/range/start",
      "op": "Const",
      "attr": [
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        },
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {},
              "int_val": 0
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/range/delta",
      "op": "Const",
      "attr": [
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        },
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {},
              "int_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/range",
      "op": "Range",
      "input": [
        "SGD/gradients/Loss/Sum_grad/range/start",
        "SGD/gradients/Loss/Sum_grad/Size",
        "SGD/gradients/Loss/Sum_grad/range/delta"
      ],
      "attr": [
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/Fill/value",
      "op": "Const",
      "attr": [
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        },
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {},
              "int_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/Fill",
      "op": "Fill",
      "input": [
        "SGD/gradients/Loss/Sum_grad/Shape_1",
        "SGD/gradients/Loss/Sum_grad/Fill/value"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/DynamicStitch",
      "op": "DynamicStitch",
      "input": [
        "SGD/gradients/Loss/Sum_grad/range",
        "SGD/gradients/Loss/Sum_grad/mod",
        "SGD/gradients/Loss/Sum_grad/Shape",
        "SGD/gradients/Loss/Sum_grad/Fill"
      ],
      "attr": [
        {
          "key": "N",
          "value": {
            "i": 2
          }
        },
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/Maximum/y",
      "op": "Const",
      "attr": [
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        },
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {},
              "int_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/Maximum",
      "op": "Maximum",
      "input": [
        "SGD/gradients/Loss/Sum_grad/DynamicStitch",
        "SGD/gradients/Loss/Sum_grad/Maximum/y"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/floordiv",
      "op": "FloorDiv",
      "input": [
        "SGD/gradients/Loss/Sum_grad/Shape",
        "SGD/gradients/Loss/Sum_grad/Maximum"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/Sum_grad/Shape"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/Reshape",
      "op": "Reshape",
      "input": [
        "SGD/gradients/Loss/Neg_grad/Neg",
        "SGD/gradients/Loss/Sum_grad/DynamicStitch"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tshape",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Sum_grad/Tile",
      "op": "Tile",
      "input": [
        "SGD/gradients/Loss/Sum_grad/Reshape",
        "SGD/gradients/Loss/Sum_grad/floordiv"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tmultiples",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/Shape",
      "op": "Shape",
      "input": [
        "LabelData"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "out_type",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/Shape_1",
      "op": "Shape",
      "input": [
        "Loss/Log"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "out_type",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/BroadcastGradientArgs",
      "op": "BroadcastGradientArgs",
      "input": [
        "SGD/gradients/Loss/mul_grad/Shape",
        "SGD/gradients/Loss/mul_grad/Shape_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/mul",
      "op": "Mul",
      "input": [
        "SGD/gradients/Loss/Sum_grad/Tile",
        "Loss/Log"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/Sum",
      "op": "Sum",
      "input": [
        "SGD/gradients/Loss/mul_grad/mul",
        "SGD/gradients/Loss/mul_grad/BroadcastGradientArgs"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/Reshape",
      "op": "Reshape",
      "input": [
        "SGD/gradients/Loss/mul_grad/Sum",
        "SGD/gradients/Loss/mul_grad/Shape"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tshape",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/mul_1",
      "op": "Mul",
      "input": [
        "LabelData",
        "SGD/gradients/Loss/Sum_grad/Tile"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/Sum_1",
      "op": "Sum",
      "input": [
        "SGD/gradients/Loss/mul_grad/mul_1",
        "SGD/gradients/Loss/mul_grad/BroadcastGradientArgs:1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/Reshape_1",
      "op": "Reshape",
      "input": [
        "SGD/gradients/Loss/mul_grad/Sum_1",
        "SGD/gradients/Loss/mul_grad/Shape_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tshape",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/tuple/group_deps",
      "op": "NoOp",
      "input": [
        "^SGD/gradients/Loss/mul_grad/Reshape",
        "^SGD/gradients/Loss/mul_grad/Reshape_1"
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/tuple/control_dependency",
      "op": "Identity",
      "input": [
        "SGD/gradients/Loss/mul_grad/Reshape",
        "^SGD/gradients/Loss/mul_grad/tuple/group_deps"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/mul_grad/Reshape"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/mul_grad/tuple/control_dependency_1",
      "op": "Identity",
      "input": [
        "SGD/gradients/Loss/mul_grad/Reshape_1",
        "^SGD/gradients/Loss/mul_grad/tuple/group_deps"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Loss/mul_grad/Reshape_1"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Log_grad/Reciprocal",
      "op": "Reciprocal",
      "input": [
        "Model/Softmax",
        "^SGD/gradients/Loss/mul_grad/tuple/control_dependency_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Loss/Log_grad/mul",
      "op": "Mul",
      "input": [
        "SGD/gradients/Loss/mul_grad/tuple/control_dependency_1",
        "SGD/gradients/Loss/Log_grad/Reciprocal"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/Softmax_grad/mul",
      "op": "Mul",
      "input": [
        "SGD/gradients/Loss/Log_grad/mul",
        "Model/Softmax"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/Softmax_grad/Sum/reduction_indices",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 1
                  }
                ]
              },
              "int_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/Softmax_grad/Sum",
      "op": "Sum",
      "input": [
        "SGD/gradients/Model/Softmax_grad/mul",
        "SGD/gradients/Model/Softmax_grad/Sum/reduction_indices"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/Softmax_grad/Reshape/shape",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 2
                  }
                ]
              },
              "tensor_content": "\\377\\377\\377\\377\\001\\000\\000\\000"
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/Softmax_grad/Reshape",
      "op": "Reshape",
      "input": [
        "SGD/gradients/Model/Softmax_grad/Sum",
        "SGD/gradients/Model/Softmax_grad/Reshape/shape"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tshape",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/Softmax_grad/sub",
      "op": "Sub",
      "input": [
        "SGD/gradients/Loss/Log_grad/mul",
        "SGD/gradients/Model/Softmax_grad/Reshape"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/Softmax_grad/mul_1",
      "op": "Mul",
      "input": [
        "SGD/gradients/Model/Softmax_grad/sub",
        "Model/Softmax"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/Shape",
      "op": "Shape",
      "input": [
        "Model/MatMul"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "out_type",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/Shape_1",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 1
                  }
                ]
              },
              "int_val": 10
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/BroadcastGradientArgs",
      "op": "BroadcastGradientArgs",
      "input": [
        "SGD/gradients/Model/add_grad/Shape",
        "SGD/gradients/Model/add_grad/Shape_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/Sum",
      "op": "Sum",
      "input": [
        "SGD/gradients/Model/Softmax_grad/mul_1",
        "SGD/gradients/Model/add_grad/BroadcastGradientArgs"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/Reshape",
      "op": "Reshape",
      "input": [
        "SGD/gradients/Model/add_grad/Sum",
        "SGD/gradients/Model/add_grad/Shape"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tshape",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/Sum_1",
      "op": "Sum",
      "input": [
        "SGD/gradients/Model/Softmax_grad/mul_1",
        "SGD/gradients/Model/add_grad/BroadcastGradientArgs:1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/Reshape_1",
      "op": "Reshape",
      "input": [
        "SGD/gradients/Model/add_grad/Sum_1",
        "SGD/gradients/Model/add_grad/Shape_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tshape",
          "value": {
            "type": "DT_INT32"
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/tuple/group_deps",
      "op": "NoOp",
      "input": [
        "^SGD/gradients/Model/add_grad/Reshape",
        "^SGD/gradients/Model/add_grad/Reshape_1"
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/tuple/control_dependency",
      "op": "Identity",
      "input": [
        "SGD/gradients/Model/add_grad/Reshape",
        "^SGD/gradients/Model/add_grad/tuple/group_deps"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Model/add_grad/Reshape"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/add_grad/tuple/control_dependency_1",
      "op": "Identity",
      "input": [
        "SGD/gradients/Model/add_grad/Reshape_1",
        "^SGD/gradients/Model/add_grad/tuple/group_deps"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Model/add_grad/Reshape_1"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/MatMul_grad/MatMul",
      "op": "MatMul",
      "input": [
        "SGD/gradients/Model/add_grad/tuple/control_dependency",
        "Weights/read"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "transpose_a",
          "value": {
            "b": false
          }
        },
        {
          "key": "transpose_b",
          "value": {
            "b": true
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/MatMul_grad/MatMul_1",
      "op": "MatMul",
      "input": [
        "InputData",
        "SGD/gradients/Model/add_grad/tuple/control_dependency"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "transpose_a",
          "value": {
            "b": true
          }
        },
        {
          "key": "transpose_b",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/MatMul_grad/tuple/group_deps",
      "op": "NoOp",
      "input": [
        "^SGD/gradients/Model/MatMul_grad/MatMul",
        "^SGD/gradients/Model/MatMul_grad/MatMul_1"
      ]
    },
    {
      "name": "SGD/gradients/Model/MatMul_grad/tuple/control_dependency",
      "op": "Identity",
      "input": [
        "SGD/gradients/Model/MatMul_grad/MatMul",
        "^SGD/gradients/Model/MatMul_grad/tuple/group_deps"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Model/MatMul_grad/MatMul"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/gradients/Model/MatMul_grad/tuple/control_dependency_1",
      "op": "Identity",
      "input": [
        "SGD/gradients/Model/MatMul_grad/MatMul_1",
        "^SGD/gradients/Model/MatMul_grad/tuple/group_deps"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@SGD/gradients/Model/MatMul_grad/MatMul_1"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "SGD/GradientDescent/learning_rate",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_FLOAT",
              "tensor_shape": {},
              "float_val": 0.009999999776482582
            }
          }
        }
      ]
    },
    {
      "name": "SGD/GradientDescent/update_Weights/ApplyGradientDescent",
      "op": "ApplyGradientDescent",
      "input": [
        "Weights",
        "SGD/GradientDescent/learning_rate",
        "SGD/gradients/Model/MatMul_grad/tuple/control_dependency_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@Weights"
              ]
            }
          }
        },
        {
          "key": "use_locking",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/GradientDescent/update_Bias/ApplyGradientDescent",
      "op": "ApplyGradientDescent",
      "input": [
        "Bias",
        "SGD/GradientDescent/learning_rate",
        "SGD/gradients/Model/add_grad/tuple/control_dependency_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "_class",
          "value": {
            "list": {
              "s": [
                "loc:@Bias"
              ]
            }
          }
        },
        {
          "key": "use_locking",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "SGD/GradientDescent",
      "op": "NoOp",
      "input": [
        "^SGD/GradientDescent/update_Weights/ApplyGradientDescent",
        "^SGD/GradientDescent/update_Bias/ApplyGradientDescent"
      ]
    },
    {
      "name": "Accuracy/ArgMax/dimension",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {},
              "int_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "Accuracy/ArgMax",
      "op": "ArgMax",
      "input": [
        "Model/Softmax",
        "Accuracy/ArgMax/dimension"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "output_type",
          "value": {
            "type": "DT_INT64"
          }
        }
      ]
    },
    {
      "name": "Accuracy/ArgMax_1/dimension",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {},
              "int_val": 1
            }
          }
        }
      ]
    },
    {
      "name": "Accuracy/ArgMax_1",
      "op": "ArgMax",
      "input": [
        "LabelData",
        "Accuracy/ArgMax_1/dimension"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "output_type",
          "value": {
            "type": "DT_INT64"
          }
        }
      ]
    },
    {
      "name": "Accuracy/Equal",
      "op": "Equal",
      "input": [
        "Accuracy/ArgMax",
        "Accuracy/ArgMax_1"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_INT64"
          }
        }
      ]
    },
    {
      "name": "Accuracy/Cast",
      "op": "Cast",
      "input": [
        "Accuracy/Equal"
      ],
      "attr": [
        {
          "key": "DstT",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "SrcT",
          "value": {
            "type": "DT_BOOL"
          }
        }
      ]
    },
    {
      "name": "Accuracy/Const",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_INT32",
              "tensor_shape": {
                "dim": [
                  {
                    "size": 1
                  }
                ]
              },
              "int_val": 0
            }
          }
        }
      ]
    },
    {
      "name": "Accuracy/Mean",
      "op": "Mean",
      "input": [
        "Accuracy/Cast",
        "Accuracy/Const"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        },
        {
          "key": "Tidx",
          "value": {
            "type": "DT_INT32"
          }
        },
        {
          "key": "keep_dims",
          "value": {
            "b": false
          }
        }
      ]
    },
    {
      "name": "init",
      "op": "NoOp",
      "input": [
        "^Weights/Assign",
        "^Bias/Assign"
      ]
    },
    {
      "name": "loss/tags",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_STRING"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_STRING",
              "tensor_shape": {},
              "string_val": [
                "loss"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "loss",
      "op": "ScalarSummary",
      "input": [
        "loss/tags",
        "Loss/Mean"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "accuracy/tags",
      "op": "Const",
      "attr": [
        {
          "key": "dtype",
          "value": {
            "type": "DT_STRING"
          }
        },
        {
          "key": "value",
          "value": {
            "tensor": {
              "dtype": "DT_STRING",
              "tensor_shape": {},
              "string_val": [
                "accuracy"
              ]
            }
          }
        }
      ]
    },
    {
      "name": "accuracy",
      "op": "ScalarSummary",
      "input": [
        "accuracy/tags",
        "Accuracy/Mean"
      ],
      "attr": [
        {
          "key": "T",
          "value": {
            "type": "DT_FLOAT"
          }
        }
      ]
    },
    {
      "name": "Merge/MergeSummary",
      "op": "MergeSummary",
      "input": [
        "loss",
        "accuracy"
      ],
      "attr": [
        {
          "key": "N",
          "value": {
            "i": 2
          }
        }
      ]
    }
  ]; */

  /**
   * A list of all the non-embedding node names which appear in the processed
   * list of raw nodes. Here we pre-allocate enough room for all the rawNodes,
   * even though there will some number of embeddings. The excess array length
   * is spliced off later.
   *
   * Experimentation shows that around 30% of the array will go unused, and
   * even for very large networks that amounts to less than 10k spaces.
   */
  let nodeNames = new Array<string>(rawNodes.length);

  return tf.graph.util
      .runAsyncTask(
          'Normalizing names', 30,
          () => {
            let opNodes = new Array<OpNode>(rawNodes.length);
            let index = 0;

            const processRawNode = rawNode => {
              let opNode = new OpNodeImpl(rawNode);
              if (isInEmbeddedPred(opNode)) {
                embeddingNodeNames.push(opNode.name);
                inEmbedding[opNode.name] = opNode;
                return opNode;
              }

              if (isOutEmbeddedPred(opNode)) {
                embeddingNodeNames.push(opNode.name);
                outEmbedding[opNode.name] = opNode;
                _.each(opNode.inputs, input => {
                  let inputName = input.name;
                  outEmbeddings[inputName] = outEmbeddings[inputName] || [];
                  outEmbeddings[inputName].push(opNode);
                });
                return opNode;
              }
              // The node is not an embedding, so add it to the names and nodes
              // lists.
              opNodes[index] = opNode;
              nodeNames[index] = opNode.name;
              index++;
              return opNode;
            };                     
            
            _.each(rawNodes, processRawNode);

            const processFunction = (func: tf.graph.proto.FunctionDef) => {
              // Give the function itself a node.
              const functionNodeName =
                  FUNCTION_LIBRARY_NODE + NAMESPACE_DELIM + func.signature.name;
              // Create an op node for the function. Mark it as part of a
              // function library.
              processRawNode({
                name: functionNodeName,
                input: [],
                device: '',
                op: '',
                attr: [],
              });

              // If the function has inputs, make nodes out of them.
              if (func.signature.input_arg) {
                // Makes an OpNode out of either an input_arg of a library
                // function.
                let currentInputIndex = 0;
                const processInput = (arg) => {
                  const opNode = processRawNode({
                    name: functionNodeName + NAMESPACE_DELIM + arg.name,
                    input: [],
                    device: '',
                    op: 'input_arg',
                    attr: [{
                      key: 'T',
                      value: {
                        type: arg.type,
                      },
                    }],
                  });
                  opNode.functionInputIndex = currentInputIndex;
                  currentInputIndex++;
                };

                // Make nodes for input args of the function. Unfortunately, the
                // pbtxt configuration language is not rich enough to
                // differentiate between an array with 1 item vs 1 object
                // property.
                if (func.signature.input_arg['name']) {
                  // There is only 1 input arg.
                  processInput(func.signature.input_arg);
                } else {
                  // There are several input args.
                  _.each(func.signature.input_arg, processInput);
                }
              }

              // Make nodes for output args of the function. Track the names of
              // output args within the keys of this object. Unlike the
              // input_args, the output_args are already defined within the
              // node_defs of the library function.
              let currentOutputIndex = 0;
              const outputArgNames = {};

              // If the function has outputs, make nodes out of them.
              if (func.signature.output_arg) {
                const processOutput = arg => {
                  outputArgNames[
                      functionNodeName + NAMESPACE_DELIM + arg.name] =
                          currentOutputIndex;
                  currentOutputIndex++;
                };
                if (func.signature.output_arg['name']) {
                  // There is only 1 output arg.
                  processOutput(func.signature.output_arg);
                } else {
                  // There are several output args.
                  _.each(func.signature.output_arg, processOutput);
                }
              }

              _.each(func.node_def, rawNode => {
                // Prefix with the name of the function so that the graph
                // correctly computes the hierarchy (and makes metanodes).
                rawNode.name = functionNodeName + '/' + rawNode.name;
                if (typeof rawNode.input === 'string') {
                  rawNode.input = [rawNode.input];
                }
                const opNode = processRawNode(rawNode);
                if (_.isNumber(outputArgNames[rawNode.name])) {
                  // Mark the node as one of the outputs of the function.
                  opNode.functionOutputIndex = outputArgNames[rawNode.name];
                }

                _.each(opNode.inputs, normalizedInput => {
                  normalizedInput.name =
                      functionNodeName + NAMESPACE_DELIM + normalizedInput.name;
                });
              });
            };

            if (graphDef.library && graphDef.library.function) {
              // This graph contains functions.
              _.each(graphDef.library.function, processFunction);
            }

            opNodes.splice(index);
            nodeNames.splice(index);
            return opNodes;
          },
          tracker)
      .then((opNodes) => {
        // Create the graph data structure from the graphlib library.
        return tf.graph.util.runAsyncTask(
            'Building the data structure', 70, () => {
              let normalizedNameDict =
                  mapStrictHierarchy(nodeNames, embeddingNodeNames);
              let graph = new SlimGraph;

              // Add the nodes to the graph.
              _.each(opNodes, opNode => {
                let normalizedName =
                    normalizedNameDict[opNode.name] || opNode.name;
                graph.nodes[normalizedName] = opNode;
                // Check if the node has out-embeddings. If yes, add them to the
                // node.
                if (opNode.name in outEmbeddings) {
                  opNode.outEmbeddings = outEmbeddings[opNode.name];
                  // Normalize the names of the out-embeddings.
                  _.each(opNode.outEmbeddings, node => {
                    node.name = normalizedNameDict[node.name] || node.name;
                  });
                }
                // Update the name of the node.
                opNode.name = normalizedName;
              });

              // Visit each node's inputs to add the edges to the graph. If the
              // input
              // is an in-embedding, then add it to the node's in-embeddings
              // instead.
              _.each(opNodes, opNode => {
                _.each(opNode.inputs, (input, i) => {
                  let inputName = input.name;
                  if (inputName in inEmbedding) {
                    let inEmbedNode = inEmbedding[inputName];
                    opNode.inEmbeddings.push(inEmbedNode);
                    // Move the inputs of the in-embedding node into incoming
                    // edges of
                    // the main node. E.g. the control dependency of a constant
                    // node
                    // should be moved to the op node where the constant is
                    // embedded.
                    for (let embedInput of inEmbedNode.inputs) {
                      addEdgeToGraph(
                          graph, normalizedNameDict[embedInput.name] ||
                              embedInput.name,
                          opNode, embedInput, params, i);
                    }
                  } else if (inputName in outEmbedding) {
                    // Move the inputs of the out-embedding node into inputs of
                    // the main node where the out-embedding points to.
                    let outEmbedNode = outEmbedding[inputName];
                    for (let embedInput of outEmbedNode.inputs) {
                      addEdgeToGraph(
                          graph, normalizedNameDict[embedInput.name] ||
                              embedInput.name,
                          opNode, input, params, i);
                    }
                  } else {
                    addEdgeToGraph(
                        graph, normalizedNameDict[inputName] || inputName,
                        opNode, input, params, i);
                  }
                });
              });

              // Normalize the names of in-embeddings.
              _.each(inEmbedding, (node, name) => {
                node.name = normalizedNameDict[node.name] || node.name;
              });
              return graph;

            }, tracker);
      });
};

/**
 * Create a new graphlib.Graph() instance with default parameters
 */
export function createGraph<N, E>(name: string, type, opt = {}):
    graphlib.Graph<N, E> {
  let graph = new graphlib.Graph<N, E>(opt);
  graph.setGraph({
    name: name,
    rankdir: 'BT',  // BT,TB,LR,RL
    type: type
  });
  return graph;
};

/**
 * Create a predicate for checking whether a node should be embedded based on
 * the specified types.
 */
function getEmbedPredicate(types: string[]) {
  return function(node: OpNode) {
    // check types
    for (let i = 0; i < types.length; i++) {
      let regExp = new RegExp(types[i]);
      if (node.op.match(regExp)) { return true; }
    }
    return false;
  };
};

/**
 * Returns a strict node name (name => name/(name)) to avoid conflicts
 * where the node name is also a namespace.
 */
export function getStrictName(name: string): string {
  let parts = name.split(NAMESPACE_DELIM);
  return name + NAMESPACE_DELIM + '(' + parts[parts.length - 1] + ')';
}

/**
 * For each op node (embedding or non-embedding), rename it if there is a
 * non-embedding node under its namespace. For example, assume node name 'A'.
 * If there is a non-embedding node under its namespace (e.g. 'A/B'), 'A' will
 * be renamed to 'A/(A)'. Then the namespace 'A' will contain 2 nodes: '(A)'
 * and 'B'. If all the nodes under 'A' are embedding nodes (e.g. constant and
 * summary), keep 'A' as an Op node and don't create a namespace.
 *
 * @param nodeNames An array of regular (non-embedding) node names.
 * @param embeddingNodeNames An array of embedding node names.
 * @return Dictionary object mapping names that need to be renamed to
 *     new names.
 */
function mapStrictHierarchy(nodeNames: string[],
    embeddingNodeNames: string[]): {[oldName: string]: string} {
  /** Dictionary that maps the old new to the new name */
  let newNameDictionary: {[oldName: string]: string} = {};
  /** Set used to store all namespaces. */
  let namespaceSet: {[namespace: string]: boolean} = {};
  // sort the nodes to make prefix check faster
  nodeNames.sort();
  // look for nodes with a prefix a,a/b -> a/(a),a/b
  for (let i = 0; i < nodeNames.length - 1; ++i) {
    let a = nodeNames[i];
    // Get all the parent namespaces of the current node
    // and add them in the namespace set.
    _.each(getHierarchicalPath(a).slice(0, -1), ns => {
      namespaceSet[ns] = true;
    });
    for (let j = i + 1; j < nodeNames.length; ++j) {
      let b = nodeNames[j];
      if (_.startsWith(b, a)) {
        if (b.length > a.length && b.charAt(a.length) === NAMESPACE_DELIM) {
          newNameDictionary[a] = getStrictName(a);
          break;
        }
      } else {
        break;
      }
    }
  }
  // Go through all the embedding node names and rename them in case they
  // collide with namespaces.
  _.each(embeddingNodeNames, embeddingName => {
    if (embeddingName in namespaceSet) {
      // Rename to follow strict hierarchy.
      newNameDictionary[embeddingName] = getStrictName(embeddingName);
    }
  });
  return newNameDictionary;
};

/**
 * Returns a list of the degrees of each node in the graph.
 */
function degreeSequence(graph: graphlib.Graph<any, any>): number[] {
  let degrees = graph.nodes().map(function(name) {
    return graph.neighbors(name).length;
  });
  degrees.sort();
  return degrees;
};

/**
 * Returns if the degree sequence of the two graphs is the same.
 */
export function hasSimilarDegreeSequence(graph1: graphlib.Graph<any, any>,
    graph2: graphlib.Graph<any, any>): boolean {
  let dg1 = degreeSequence(graph1);
  let dg2 = degreeSequence(graph2);

  for (let i = 0; i < dg1.length; i++) {
    if (dg1[i] !== dg2[i]) {
      return false;
    }
  }
  return true;
};

/**
 * Returns the hierarchical path of the current node, based on the node's name.
 * For example, if the name is 'a/b/c', the returned path is
 * ['a', 'a/b', 'a/b/c'].
 */
export function getHierarchicalPath(name: string,
  seriesNames?: { [name: string]: string }): string[] {
  let path: string[] = [];
  let i = name.indexOf(NAMESPACE_DELIM);
  // Push all parent portions of the path.
  while (i >= 0) {
    path.push(name.substring(0, i));
    i = name.indexOf(NAMESPACE_DELIM, i + 1);
  }
  // If the node's path is under a series, then add the series node name to the
  // hierarchical path as the parent of the leaf.
  if (seriesNames) {
    let seriesName = seriesNames[name];
    if (seriesName) {
      path.push(seriesName);
    }
  }
  // Push the leaf of the path.
  path.push(name);
  return path;
};

/**
 * Returns the string for the node inclusion toggle button, dependant
 * on the provided current InclusionType.
 */
export function getIncludeNodeButtonString(include: InclusionType) {
  if (include === tf.graph.InclusionType.EXCLUDE) {
    return 'Add to main graph';
  } else {
    return 'Remove from main graph';
  }
};

/**
 * Returns the string for the series node grouping toggle button, dependant
 * on the provided current SeriesGroupingType.
 */
export function getGroupSeriesNodeButtonString(group: SeriesGroupingType) {
  if (group === tf.graph.SeriesGroupingType.GROUP) {
    return 'Ungroup this series of nodes';
  } else {
    return 'Group this series of nodes';
  }
};

/**
 * Toggle the node series grouping option in the provided map, setting it
 * to ungroup if the series is not already in the map.
 */
export function toggleNodeSeriesGroup(
  map: { [name: string]: tf.graph.SeriesGroupingType }, name: string) {
  if (!(name in map) || map[name] === tf.graph.SeriesGroupingType.GROUP) {
    map[name] = tf.graph.SeriesGroupingType.UNGROUP;
  } else {
    map[name] = tf.graph.SeriesGroupingType.GROUP;
  }
};

} // close module tf.graph

