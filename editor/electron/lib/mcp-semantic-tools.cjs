'use strict';

// AI 语义工具：面向“让 AI 独立做完一个游戏”，而不是逐个暴露底层 command。
// 每个 mutation 都返回受影响区域快照（由 mcp-server 统一附加）。
const { buildBlueprintSummary } = require('./blueprint-snapshot.cjs');

function toolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function okOrThrow(result) {
  if (!result || !result.ok) {
    throw toolError(result?.error?.code ?? 'E_COMMAND_FAILED', result?.error?.message ?? '命令执行失败');
  }
  return result;
}

function patchNode(project, nodeId, patch) {
  return {
    ...project,
    nodes: project.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
  };
}

function nodeById(project, nodeId) {
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node) throw toolError('E_NODE_NOT_FOUND', `节点不存在：${nodeId}`);
  return node;
}

function oldEdgeAt(project, nodeId, port) {
  return (
    project.edges.find(
      (edge) => edge.from === nodeId && edge.port === port && edge.kind !== 'data',
    ) ?? null
  );
}

function createDialogueChain(project, args, run) {
  const lines = Array.isArray(args.lines) ? args.lines : [];
  if (lines.length === 0) throw toolError('E_INVALID_PARAMS', 'lines 至少需要一条台词');
  if (args.after_node) nodeById(project, args.after_node);
  if (args.tail_node) nodeById(project, args.tail_node);
  const baseNode = args.after_node ? nodeById(project, args.after_node) : null;
  const base = baseNode?.position ?? { x: 0, y: 0 };
  const oldEdge = args.after_node
    ? oldEdgeAt(project, args.after_node, args.after_exit || 'next')
    : null;
  const created = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const createdNode = okOrThrow(
      run(project, 'blueprint.createNode', {
        type: 'dialogue',
        name: line.name || `台词 ${index + 1}`,
        position: { x: base.x + 340 * (index + 1), y: base.y + (index % 2 === 0 ? 0 : 60) },
      }),
    );
    project = createdNode.project;
    const nodeId = createdNode.affectedNodeIds[0];
    project = okOrThrow(
      run(project, 'blueprint.updateDialogue', {
        nodeId,
        text: String(line.text ?? ''),
        ...(line.speaker !== undefined ? { speaker: line.speaker } : null),
      }),
    ).project;
    created.push(nodeId);
  }
  if (args.after_node) {
    project = okOrThrow(
      run(project, 'blueprint.connect', {
        fromNodeId: args.after_node,
        fromExitId: args.after_exit || 'next',
        toNodeId: created[0],
      }),
    ).project;
  }
  for (let index = 0; index < created.length - 1; index += 1) {
    project = okOrThrow(
      run(project, 'blueprint.connect', {
        fromNodeId: created[index],
        fromExitId: 'next',
        toNodeId: created[index + 1],
      }),
    ).project;
  }
  const tailTarget = args.tail_node ?? oldEdge?.to ?? null;
  if (tailTarget) {
    project = okOrThrow(
      run(project, 'blueprint.connect', {
        fromNodeId: created[created.length - 1],
        fromExitId: 'next',
        toNodeId: tailTarget,
      }),
    ).project;
  }
  return {
    project,
    affectedNodeIds: [...(args.after_node ? [args.after_node] : []), ...created, ...(tailTarget ? [tailTarget] : [])],
    affectedTrackIds: [],
    data: { created_node_ids: created, first_node_id: created[0], last_node_id: created[created.length - 1] },
    warnings: oldEdge && tailTarget === oldEdge.to ? [] : [],
  };
}

function createBranch(project, args, run) {
  const fromNode = nodeById(project, args.from_node);
  const toNode = nodeById(project, args.to_node);
  if (args.false_node) nodeById(project, args.false_node);
  const fromExit = args.from_exit || 'next';
  if (!(fromNode.exits ?? []).some((exit) => exit.id === fromExit)) {
    throw toolError('E_EXIT_NOT_FOUND', `源节出口不存在：${fromNode.id}.${fromExit}`);
  }
  const oldEdge = oldEdgeAt(project, args.from_node, fromExit);
  const conditionNode = okOrThrow(
    run(project, 'blueprint.createNode', {
      type: 'condition',
      name: args.name || '条件分支',
      position: args.position ?? {
        x: ((fromNode.position?.x ?? 0) + (toNode.position?.x ?? 0)) / 2 || (fromNode.position?.x ?? 0) + 320,
        y: ((fromNode.position?.y ?? 0) + (toNode.position?.y ?? 0)) / 2,
      },
    }),
  );
  project = conditionNode.project;
  const conditionId = conditionNode.affectedNodeIds[0];
  project = patchNode(project, conditionId, { expression: String(args.condition) });
  project = okOrThrow(
    run(project, 'blueprint.connect', { fromNodeId: args.from_node, fromExitId: fromExit, toNodeId: conditionId }),
  ).project;
  project = okOrThrow(
    run(project, 'blueprint.connect', { fromNodeId: conditionId, fromExitId: 'true', toNodeId: args.to_node }),
  ).project;
  const falseTarget = args.false_node ?? oldEdge?.to ?? null;
  if (falseTarget) {
    project = okOrThrow(
      run(project, 'blueprint.connect', { fromNodeId: conditionId, fromExitId: 'false', toNodeId: falseTarget }),
    ).project;
  }
  return {
    project,
    affectedNodeIds: [args.from_node, conditionId, args.to_node, ...(falseTarget ? [falseTarget] : [])],
    affectedTrackIds: [],
    data: {
      condition_node_id: conditionId,
      false_target: falseTarget,
      replaced_edge_id: oldEdge?.id ?? null,
    },
    warnings: falseTarget ? [] : ['false 分支未连接，保持悬空'],
  };
}

function createChoice(project, args, run) {
  if (args.after_node) nodeById(project, args.after_node);
  const options = Array.isArray(args.options) ? args.options : [];
  if (options.length < 2 || options.length > 12) {
    throw toolError('E_INVALID_PARAMS', 'choice options 数量必须在 2–12 之间');
  }
  for (const option of options) {
    if (option.to_node) nodeById(project, option.to_node);
  }
  const base = args.after_node ? nodeById(project, args.after_node).position : { x: 0, y: 0 };
  const created = okOrThrow(
    run(project, 'blueprint.createNode', {
      type: 'choice',
      name: args.name || '选项',
      position: args.position ?? { x: (base?.x ?? 0) + 340, y: (base?.y ?? 0) + 120 },
    }),
  );
  project = created.project;
  const choiceId = created.affectedNodeIds[0];
  project = patchNode(project, choiceId, { prompt: String(args.prompt ?? '') });
  const choiceNode = nodeById(project, choiceId);
  while (choiceNode.exits.length < options.length) {
    project = okOrThrow(
      run(project, 'blueprint.addExit', { nodeId: choiceId, name: `选项 ${choiceNode.exits.length + 1}` }),
    ).project;
    choiceNode.exits = nodeById(project, choiceId).exits;
  }
  for (let index = 0; index < options.length; index += 1) {
    const exitId = nodeById(project, choiceId).exits[index].id;
    project = okOrThrow(
      run(project, 'blueprint.updateExit', { nodeId: choiceId, exitId, name: String(options[index].label) }),
    ).project;
  }
  if (args.after_node) {
    project = okOrThrow(
      run(project, 'blueprint.connect', {
        fromNodeId: args.after_node,
        fromExitId: args.after_exit || 'next',
        toNodeId: choiceId,
      }),
    ).project;
  }
  for (let index = 0; index < options.length; index += 1) {
    if (!options[index].to_node) continue;
    const exitId = nodeById(project, choiceId).exits[index].id;
    project = okOrThrow(
      run(project, 'blueprint.connect', {
        fromNodeId: choiceId,
        fromExitId: exitId,
        toNodeId: options[index].to_node,
      }),
    ).project;
  }
  return {
    project,
    affectedNodeIds: [choiceId, ...(args.after_node ? [args.after_node] : []), ...options.map((option) => option.to_node).filter(Boolean)],
    affectedTrackIds: [],
    data: { choice_node_id: choiceId, exit_ids: nodeById(project, choiceId).exits.map((exit) => exit.id) },
    warnings: options.some((option) => !option.to_node) ? ['部分选项未连接目标节点'] : [],
  };
}

function configureScene(project, args, run) {
  const scene = nodeById(project, args.scene_node);
  if (scene.type !== 'scene') throw toolError('E_NOT_SCENE', `节点 ${scene.id} 不是场景节点`);
  if (args.background) {
    project = okOrThrow(
      run(project, 'scene.setBackground', {
        sceneNodeId: scene.id,
        assetId: args.background.asset_id,
        ...(args.background.fit !== undefined ? { fit: args.background.fit } : null),
        ...(args.background.x !== undefined ? { x: args.background.x } : null),
        ...(args.background.y !== undefined ? { y: args.background.y } : null),
        ...(args.background.scale !== undefined ? { scale: args.background.scale } : null),
        ...(args.background.opacity !== undefined ? { opacity: args.background.opacity } : null),
      }),
    ).project;
  }
  if (args.bgm) {
    project = okOrThrow(
      run(project, 'scene.setBgm', {
        sceneNodeId: scene.id,
        assetId: args.bgm.asset_id,
        ...(args.bgm.volume !== undefined ? { volume: args.bgm.volume } : null),
        ...(args.bgm.loop !== undefined ? { loop: args.bgm.loop } : null),
        ...(args.bgm.fade_in_ms !== undefined ? { fadeInMs: args.bgm.fade_in_ms } : null),
      }),
    ).project;
  }
  for (const sprite of Array.isArray(args.sprites) ? args.sprites : []) {
    const current = nodeById(project, scene.id).sprites ?? [];
    const existing = sprite.id ? current.find((item) => item.id === sprite.id) : null;
    if (existing) {
      project = okOrThrow(
        run(project, 'scene.updateSprite', {
          sceneNodeId: scene.id,
          spriteId: sprite.id,
          ...(sprite.asset_id !== undefined ? { assetId: sprite.asset_id } : null),
          ...(sprite.x !== undefined ? { x: sprite.x } : null),
          ...(sprite.y !== undefined ? { y: sprite.y } : null),
          ...(sprite.scale !== undefined ? { scale: sprite.scale } : null),
          ...(sprite.z_index !== undefined ? { zIndex: sprite.z_index } : null),
          ...(sprite.opacity !== undefined ? { opacity: sprite.opacity } : null),
        }),
      ).project;
    } else {
      project = okOrThrow(
        run(project, 'scene.addSprite', {
          sceneNodeId: scene.id,
          assetId: sprite.asset_id,
          ...(sprite.id !== undefined ? { id: sprite.id } : null),
          ...(sprite.x !== undefined ? { x: sprite.x } : null),
          ...(sprite.y !== undefined ? { y: sprite.y } : null),
          ...(sprite.scale !== undefined ? { scale: sprite.scale } : null),
          ...(sprite.z_index !== undefined ? { zIndex: sprite.z_index } : null),
          ...(sprite.opacity !== undefined ? { opacity: sprite.opacity } : null),
        }),
      ).project;
    }
  }
  return {
    project,
    affectedNodeIds: [scene.id],
    affectedTrackIds: [],
    data: { scene_node_id: scene.id },
    warnings: [],
  };
}

function addSceneKeyframes(project, args, run) {
  nodeById(project, args.scene_node);
  const keyframes = Array.isArray(args.keyframes) ? args.keyframes : [];
  if (keyframes.length === 0) throw toolError('E_INVALID_PARAMS', 'keyframes 不能为空');
  if (args.duration_ms !== undefined) {
    project = okOrThrow(
      run(project, 'timeline.setDuration', { sceneNodeId: args.scene_node, durationMs: args.duration_ms }),
    ).project;
  }
  let trackId = null;
  const trackIds = new Set();
  for (const keyframe of keyframes) {
    const result = okOrThrow(
      run(project, 'timeline.addKeyframe', {
        sceneNodeId: args.scene_node,
        ...(trackId ? { trackId } : { kind: args.track.kind, property: args.track.property }),
        ...(args.track.target !== undefined ? { target: args.track.target } : null),
        time: keyframe.time,
        value: keyframe.value,
        ...(keyframe.easing !== undefined ? { easing: keyframe.easing } : null),
        ...(keyframe.preset !== undefined ? { preset: keyframe.preset } : null),
        ...(keyframe.intensity !== undefined ? { intensity: keyframe.intensity } : null),
      }),
    );
    project = result.project;
    trackId = result.affectedTrackIds[0];
    trackIds.add(trackId);
  }
  return {
    project,
    affectedNodeIds: [args.scene_node],
    affectedTrackIds: [...trackIds],
    data: { track_id: trackId, keyframe_count: keyframes.length },
    warnings: [],
  };
}

const TOOL_DEFS = [
  {
    name: 'get_blueprint_summary',
    description:
      '拉取当前项目全局概况：节点/连线/类型统计、所有节点 ID 与坐标、悬空端口、孤立节点、断连组件、断链 jump、时间轴、素材列表与 start node。AI 应先调用它再决定如何编辑。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        include_edges: { type: 'boolean', default: false, description: '是否返回全部连线（默认只返回统计与悬空端口）' },
        projectPath: { type: 'string' },
      },
    },
    readOnly: true,
  },
  {
    name: 'create_scene_node',
    description: '创建一个可玩的场景节点，可同时设置背景图、BGM 与初始立绘，返回节点与受影响区域快照。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80 },
        position: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y'],
          properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
        background_asset_id: { type: 'string', minLength: 1, maxLength: 64 },
        bgm_asset_id: { type: 'string', minLength: 1, maxLength: 64 },
        sprites: { type: 'array', maxItems: 32, items: { type: 'object' } },
        projectPath: { type: 'string' },
      },
    },
  },
  {
    name: 'create_dialogue_chain',
    description:
      '批量创建一串对话节点并自动串好连线；可指定从哪个节点的哪个出口接入，以及末尾接回哪个节点（默认接回原出口的目标，保持旧流程）。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['lines'],
      properties: {
        after_node: { type: 'string', minLength: 1, maxLength: 64 },
        after_exit: { type: 'string', minLength: 1, maxLength: 64 },
        tail_node: { type: 'string', minLength: 1, maxLength: 64 },
        lines: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text'],
            properties: {
              text: { type: 'string', maxLength: 20000 },
              speaker: { oneOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }] },
              name: { type: 'string', minLength: 1, maxLength: 80 },
            },
          },
        },
        projectPath: { type: 'string' },
      },
    },
  },
  {
    name: 'create_branch_node',
    description:
      '在一条已有出口上插入条件分支：from_node → 条件节点 → true 目标；false 分支可显式指定，省略时自动接回原出口目标，保持旧流程。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['from_node', 'condition', 'to_node'],
      properties: {
        from_node: { type: 'string', minLength: 1, maxLength: 64 },
        from_exit: { type: 'string', minLength: 1, maxLength: 64 },
        condition: { type: 'string', minLength: 1, maxLength: 500 },
        to_node: { type: 'string', minLength: 1, maxLength: 64 },
        false_node: { type: 'string', minLength: 1, maxLength: 64 },
        name: { type: 'string', minLength: 1, maxLength: 80 },
        position: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y'],
          properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
        projectPath: { type: 'string' },
      },
    },
  },
  {
    name: 'create_choice_node',
    description:
      '创建一个选项节点，自动配置 2–12 个选项并连接到目标节点；选项目标可省略（保持悬空，后续再连）。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'options'],
      properties: {
        after_node: { type: 'string', minLength: 1, maxLength: 64 },
        after_exit: { type: 'string', minLength: 1, maxLength: 64 },
        prompt: { type: 'string', maxLength: 2000 },
        name: { type: 'string', minLength: 1, maxLength: 80 },
        position: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y'],
          properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['label'],
            properties: {
              label: { type: 'string', minLength: 1, maxLength: 120 },
              to_node: { type: 'string', minLength: 1, maxLength: 64 },
            },
          },
        },
        projectPath: { type: 'string' },
      },
    },
  },
  {
    name: 'connect_blueprint_nodes',
    description: '把源节点出口连接到目标节点，同一出口旧连线会被替换；返回受影响区域快照。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['from_node', 'from_exit', 'to_node'],
      properties: {
        from_node: { type: 'string', minLength: 1, maxLength: 64 },
        from_exit: { type: 'string', minLength: 1, maxLength: 64 },
        to_node: { type: 'string', minLength: 1, maxLength: 64 },
        projectPath: { type: 'string' },
      },
    },
  },
  {
    name: 'configure_scene_stage',
    description: '配置场景舞台：背景、BGM、以及多个立绘（新增或更新），一次调用完成并返回场景快照。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['scene_node'],
      properties: {
        scene_node: { type: 'string', minLength: 1, maxLength: 64 },
        background: {
          type: 'object',
          additionalProperties: false,
          required: ['asset_id'],
          properties: {
            asset_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
            fit: { enum: ['cover', 'contain', 'stretch'] },
            x: { type: 'number', minimum: 0, maximum: 1 },
            y: { type: 'number', minimum: 0, maximum: 1 },
            scale: { type: 'number', minimum: 0.05, maximum: 10 },
            opacity: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
        bgm: {
          type: 'object',
          additionalProperties: false,
          required: ['asset_id'],
          properties: {
            asset_id: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
            volume: { type: 'number', minimum: 0, maximum: 1 },
            loop: { type: 'boolean' },
            fade_in_ms: { type: 'integer', minimum: 0, maximum: 60000 },
          },
        },
        sprites: {
          type: 'array',
          maxItems: 32,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['asset_id'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 64 },
              asset_id: { type: 'string', minLength: 1, maxLength: 64 },
              x: { type: 'number', minimum: 0, maximum: 1 },
              y: { type: 'number', minimum: 0, maximum: 1 },
              scale: { type: 'number', minimum: 0.05, maximum: 10 },
              z_index: { type: 'integer', minimum: 0, maximum: 1000 },
              opacity: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
        projectPath: { type: 'string' },
      },
    },
  },
  {
    name: 'add_scene_keyframes',
    description: '为场景的一条轨道批量添加关键帧（自动创建时间轴/轨道）；返回受影响场景与轨道快照。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['scene_node', 'track', 'keyframes'],
      properties: {
        scene_node: { type: 'string', minLength: 1, maxLength: 64 },
        duration_ms: { type: 'integer', minimum: 100, maximum: 600000 },
        track: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'property'],
          properties: {
            kind: { enum: ['sprite', 'background', 'audio', 'textbox'] },
            target: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
            property: { type: 'string', minLength: 1, maxLength: 40 },
          },
        },
        keyframes: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['time', 'value'],
            properties: {
              time: { type: 'integer', minimum: 0, maximum: 600000 },
              value: { type: 'number' },
              preset: { enum: ['linear', 'easeIn', 'easeOut', 'easeInOut'] },
              intensity: { type: 'number', minimum: 0, maximum: 1 },
              easing: {
                type: 'object',
                additionalProperties: false,
                required: ['p1', 'p2'],
                properties: {
                  p1: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: 0, maximum: 1 } },
                  p2: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: 0, maximum: 1 } },
                },
              },
            },
          },
        },
        projectPath: { type: 'string' },
      },
    },
  },
  {
    name: 'update_project_settings',
    description: '更新项目标题/作者/简介/分辨率/开始节点，返回更新后的项目摘要。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        author: { type: 'string', maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        resolution: {
          type: 'object',
          additionalProperties: false,
          required: ['width', 'height'],
          properties: {
            width: { type: 'integer', minimum: 320, maximum: 7680 },
            height: { type: 'integer', minimum: 240, maximum: 4320 },
          },
        },
        start_node_id: { type: 'string', minLength: 1, maxLength: 64 },
        projectPath: { type: 'string' },
      },
    },
  },
];

function executeSemanticTool(toolName, project, args, bus, run) {
  const exec = (current, command, params) => okOrThrow(run(current, command, params));
  switch (toolName) {
    case 'get_blueprint_summary':
      return {
        project,
        readOnly: true,
        data: buildBlueprintSummary(project, { includeEdges: Boolean(args.include_edges) }),
        affectedNodeIds: [],
        affectedTrackIds: [],
        warnings: [],
      };
    case 'create_scene_node': {
      const created = exec(project, 'blueprint.createNode', {
        type: 'scene',
        name: args.name,
        ...(args.position ? { position: args.position } : null),
      });
      project = created.project;
      const sceneId = created.affectedNodeIds[0];
      if (args.background_asset_id) {
        project = exec(project, 'scene.setBackground', {
          sceneNodeId: sceneId,
          assetId: args.background_asset_id,
          fit: 'cover',
          opacity: 1,
        }).project;
      }
      if (args.bgm_asset_id) {
        project = exec(project, 'scene.setBgm', {
          sceneNodeId: sceneId,
          assetId: args.bgm_asset_id,
          volume: 0.7,
          loop: true,
          fadeInMs: 1200,
        }).project;
      }
      for (const sprite of Array.isArray(args.sprites) ? args.sprites : []) {
        project = exec(project, 'scene.addSprite', {
          sceneNodeId: sceneId,
          assetId: sprite.asset_id,
          ...(sprite.x !== undefined ? { x: sprite.x } : null),
          ...(sprite.y !== undefined ? { y: sprite.y } : null),
          ...(sprite.scale !== undefined ? { scale: sprite.scale } : null),
          ...(sprite.z_index !== undefined ? { zIndex: sprite.z_index } : null),
          ...(sprite.opacity !== undefined ? { opacity: sprite.opacity } : null),
        }).project;
      }
      return { project, affectedNodeIds: [sceneId], affectedTrackIds: [], data: { scene_node_id: sceneId }, warnings: [] };
    }
    case 'create_dialogue_chain':
      return createDialogueChain(project, args, (current, command, params) => exec(current, command, params));
    case 'create_branch_node':
      return createBranch(project, args, (current, command, params) => exec(current, command, params));
    case 'create_choice_node':
      return createChoice(project, args, (current, command, params) => exec(current, command, params));
    case 'connect_blueprint_nodes': {
      const result = exec(project, 'blueprint.connect', {
        fromNodeId: args.from_node,
        fromExitId: args.from_exit,
        toNodeId: args.to_node,
      });
      return {
        project: result.project,
        affectedNodeIds: result.affectedNodeIds,
        affectedTrackIds: [],
        data: result.data,
        warnings: result.warnings,
      };
    }
    case 'configure_scene_stage':
      return configureScene(project, args, (current, command, params) => exec(current, command, params));
    case 'add_scene_keyframes':
      return addSceneKeyframes(project, args, (current, command, params) => exec(current, command, params));
    case 'update_project_settings': {
      if (args.start_node_id) nodeById(project, args.start_node_id);
      const meta = {
        ...(project.meta ?? {}),
        ...(args.title !== undefined ? { title: args.title } : null),
        ...(args.author !== undefined ? { author: args.author } : null),
        ...(args.description !== undefined ? { description: args.description } : null),
        updatedAt: new Date().toISOString(),
      };
      const settings = {
        ...(project.settings ?? {}),
        ...(args.resolution ? { resolution: args.resolution } : null),
        ...(args.start_node_id ? { startNodeId: args.start_node_id } : null),
      };
      return {
        project: { ...project, meta, settings },
        affectedNodeIds: args.start_node_id ? [args.start_node_id] : [],
        affectedTrackIds: [],
        data: { title: meta.title, settings },
        warnings: [],
      };
    }
    default:
      throw toolError('E_UNKNOWN_TOOL', `未知语义工具：${toolName}`);
  }
}

module.exports = { TOOL_DEFS, executeSemanticTool };
