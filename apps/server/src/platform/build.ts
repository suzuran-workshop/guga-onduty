/**
 * 第三方平台装配 —— @homurajs/3p 的钉钉实现（自 guga-onduty-w 移植）。
 *
 * 设计要点：
 *  - **凭证缺失即降级，不抛错**。appKey/appSecret 未配 → platform=null，
 *    通知服务据此把推送落库标记 pending（凭证到位后可补发），绝不阻塞业务主链路。
 *  - agentId 无法从 appKey 反推（实测 microApp/apps 不返回 appKey），故必须显式配置；
 *    缺失时推送无法发出（asyncsend_v2 必需 agent_id），同样降级为 pending。
 *
 * 能力清单（3p 声明，运行时用 supports() 协商）：
 *  message（工作通知 + 投递回执）/ contacts（通讯录，含 fetchAllContacts）/ apps（agentId 发现）
 *  / approval / oauth（配了 oauthOrgId 才声明）。
 */
import { supports, type ThirdPartyPlatform } from '@homurajs/3p';
import { createDingtalkPlatform } from '@homurajs/3p/dingtalk';
import type { AppConfig } from '../config.js';

export interface PlatformBundle {
  /** 钉钉平台实例；凭证不全时为 null（调用方据此降级） */
  platform: ThirdPartyPlatform | null;
  /** 工作通知的 agentId（platform 非 null 时必有） */
  agentId: string | null;
  /** 是否已启用推送（platform + agentId + message 能力齐备） */
  canSend: boolean;
  /** 降级原因（canSend=false 时供日志/后台展示，便于排障） */
  reason?: string;
}

/**
 * 装配钉钉平台。凭证不全时返回降级 bundle（platform=null），不抛错。
 */
export function buildPlatform(
  cfg: AppConfig,
  logger?: { info: (m: string, f?: any) => void; warn: (m: string, f?: any) => void },
): PlatformBundle {
  const appKey = cfg.get('dingtalkAppKey');
  const appSecret = cfg.get('dingtalkAppSecret');
  const agentId = cfg.get('dingtalkAgentId');
  const oauthOrgId = cfg.get('oauthDingtalkOrgId');

  if (!appKey || !appSecret) {
    const reason = 'DINGTALK_APP_KEY / DINGTALK_APP_SECRET 未配置';
    logger?.warn('platform: 钉钉未启用，推送将落库为 pending 待补发', { reason });
    return { platform: null, agentId: null, canSend: false, reason };
  }

  const platform = createDingtalkPlatform({
    appKey,
    appSecret,
    agentId: agentId ?? undefined,
    oauthOrgId: oauthOrgId || undefined,
    oauthBaseUrl: cfg.get('oauthDingtalkBaseUrl') || undefined,
  });

  const hasMessage = supports(platform, 'message');
  if (!hasMessage) {
    const reason = '平台未声明 message 能力';
    logger?.warn('platform: 无 message 能力，推送将落库为 pending', { reason });
    return { platform, agentId: agentId ?? null, canSend: false, reason };
  }
  if (!agentId) {
    const reason = 'DINGTALK_AGENT_ID 未配置（asyncsend_v2 必需，且无法从 AppKey 反推）';
    logger?.warn('platform: 缺 agentId，推送将落库为 pending', { reason });
    return { platform, agentId: null, canSend: false, reason };
  }

  logger?.info('platform: 钉钉已启用', {
    capabilities: platform.capabilities,
    agentId,
    oauth: supports(platform, 'oauth'),
  });
  return { platform, agentId, canSend: true };
}
