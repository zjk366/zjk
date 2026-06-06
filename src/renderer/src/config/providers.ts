import ZhinaoProviderLogo from '@renderer/assets/images/models/360.png'
import HunyuanProviderLogo from '@renderer/assets/images/models/hunyuan.png'
import AzureProviderLogo from '@renderer/assets/images/models/microsoft.png'
import Ai302ProviderLogo from '@renderer/assets/images/providers/302ai.webp'
import AiHubMixProviderLogo from '@renderer/assets/images/providers/aihubmix.webp'
import AiOnlyProviderLogo from '@renderer/assets/images/providers/aiOnly.webp'
import AlayaNewProviderLogo from '@renderer/assets/images/providers/alayanew.webp'
import AnthropicProviderLogo from '@renderer/assets/images/providers/anthropic.png'
import AwsProviderLogo from '@renderer/assets/images/providers/aws-bedrock.webp'
import BaichuanProviderLogo from '@renderer/assets/images/providers/baichuan.png'
import BaiduCloudProviderLogo from '@renderer/assets/images/providers/baidu-cloud.svg'
import BailianProviderLogo from '@renderer/assets/images/providers/bailian.png'
import BurnCloudProviderLogo from '@renderer/assets/images/providers/burncloud.png'
import CephalonProviderLogo from '@renderer/assets/images/providers/cephalon.jpeg'
import CerebrasProviderLogo from '@renderer/assets/images/providers/cerebras.webp'
import CherryInProviderLogo from '@renderer/assets/images/providers/cherryin.png'
import BlackholeProviderLogo from '@renderer/assets/images/providers/blackhole.png'
import DeepSeekProviderLogo from '@renderer/assets/images/providers/deepseek.png'
import DmxapiProviderLogo from '@renderer/assets/images/providers/DMXAPI.png'
import FireworksProviderLogo from '@renderer/assets/images/providers/fireworks.png'
import GiteeAIProviderLogo from '@renderer/assets/images/providers/gitee-ai.png'
import GithubProviderLogo from '@renderer/assets/images/providers/github.png'
import GoogleProviderLogo from '@renderer/assets/images/providers/google.png'
import GPUStackProviderLogo from '@renderer/assets/images/providers/gpustack.svg'
import GrokProviderLogo from '@renderer/assets/images/providers/grok.png'
import GroqProviderLogo from '@renderer/assets/images/providers/groq.png'
import HuggingfaceProviderLogo from '@renderer/assets/images/providers/huggingface.webp'
import HyperbolicProviderLogo from '@renderer/assets/images/providers/hyperbolic.png'
import InfiniProviderLogo from '@renderer/assets/images/providers/infini.png'
import IntelOvmsLogo from '@renderer/assets/images/providers/intel.png'
import JinaProviderLogo from '@renderer/assets/images/providers/jina.png'
import LanyunProviderLogo from '@renderer/assets/images/providers/lanyun.png'
import LMStudioProviderLogo from '@renderer/assets/images/providers/lmstudio.png'
import LongCatProviderLogo from '@renderer/assets/images/providers/longcat.png'
import MiMoProviderLogo from '@renderer/assets/images/providers/mimo.svg'
import MinimaxProviderLogo from '@renderer/assets/images/providers/minimax.png'
import MistralProviderLogo from '@renderer/assets/images/providers/mistral.png'
import ModelScopeProviderLogo from '@renderer/assets/images/providers/modelscope.png'
import MoonshotProviderLogo from '@renderer/assets/images/providers/moonshot.webp'
import NewAPIProviderLogo from '@renderer/assets/images/providers/newapi.png'
import NvidiaProviderLogo from '@renderer/assets/images/providers/nvidia.png'
import O3ProviderLogo from '@renderer/assets/images/providers/o3.png'
import OcoolAiProviderLogo from '@renderer/assets/images/providers/ocoolai.png'
import OllamaProviderLogo from '@renderer/assets/images/providers/ollama.png'
import OpenAiProviderLogo from '@renderer/assets/images/providers/openai.png'
import OpenRouterProviderLogo from '@renderer/assets/images/providers/openrouter.png'
import PerplexityProviderLogo from '@renderer/assets/images/providers/perplexity.png'
import Ph8ProviderLogo from '@renderer/assets/images/providers/ph8.png'
import PPIOProviderLogo from '@renderer/assets/images/providers/ppio.png'
import QiniuProviderLogo from '@renderer/assets/images/providers/qiniu.webp'
import SiliconFlowProviderLogo from '@renderer/assets/images/providers/silicon.png'
import SophnetProviderLogo from '@renderer/assets/images/providers/sophnet.svg'
import StepProviderLogo from '@renderer/assets/images/providers/step.png'
import TencentCloudProviderLogo from '@renderer/assets/images/providers/tencent-cloud-ti.png'
import TogetherProviderLogo from '@renderer/assets/images/providers/together.png'
import TokenFluxProviderLogo from '@renderer/assets/images/providers/tokenflux.png'
import AIGatewayProviderLogo from '@renderer/assets/images/providers/vercel.svg'
import VertexAIProviderLogo from '@renderer/assets/images/providers/vertexai.svg'
import BytedanceProviderLogo from '@renderer/assets/images/providers/volcengine.png'
import VoyageAIProviderLogo from '@renderer/assets/images/providers/voyageai.png'
import XirangProviderLogo from '@renderer/assets/images/providers/xirang.png'
import ZaiAppLogo from '@renderer/assets/images/providers/zai.svg'
import ZeroOneProviderLogo from '@renderer/assets/images/providers/zero-one.png'
import ZhipuProviderLogo from '@renderer/assets/images/providers/zhipu.png'
import type { AtLeast, SystemProvider, SystemProviderId } from '@renderer/types'
import { OpenAIServiceTiers } from '@renderer/types'
import { TOKENFLUX_HOST } from './constant'
import { qwenModel, SYSTEM_MODELS } from './models'

export const CHERRYAI_PROVIDER: SystemProvider = {
  id: 'cherryai' as SystemProviderId,
  name: 'Blackhole',
  type: 'openai',
  apiKey: '',
  apiHost: 'http://8.137.146.148:9000/v1',
  models: [qwenModel],
  isSystem: true,
  enabled: true
}

export const SYSTEM_PROVIDERS_CONFIG: Record<SystemProviderId, SystemProvider> = {
  blackhole: { id:'blackhole', name:'\u9ed1\u6d1e', type:'openai', apiKey:'', apiHost:'http://8.137.146.148:9000/v1', anthropicApiHost:'http://8.137.146.148:9000/v1', models:[], isSystem:true, enabled:true },
  openai: { id:'openai', name:'OpenAI', type:'openai-response', apiKey:'', apiHost:'https://api.openai.com', models:SYSTEM_MODELS.openai, isSystem:true, enabled:false, serviceTier:OpenAIServiceTiers.auto },
  anthropic: { id:'anthropic', name:'Anthropic', type:'anthropic', apiKey:'', apiHost:'https://api.anthropic.com', models:SYSTEM_MODELS.anthropic, isSystem:true, enabled:false },
  gemini: { id:'gemini', name:'Gemini', type:'gemini', apiKey:'', apiHost:'https://generativelanguage.googleapis.com', models:SYSTEM_MODELS.gemini, isSystem:true, enabled:false, isVertex:false },
  deepseek: { id:'deepseek', name:'DeepSeek', type:'openai', apiKey:'', apiHost:'https://api.deepseek.com', anthropicApiHost:'https://api.deepseek.com/anthropic', models:SYSTEM_MODELS.deepseek, isSystem:true, enabled:false },
  silicon: { id:'silicon', name:'Silicon', type:'openai', apiKey:'', apiHost:'https://api.siliconflow.cn', anthropicApiHost:'https://api.siliconflow.cn', models:SYSTEM_MODELS.silicon, isSystem:true, enabled:false },
  zhipu: { id:'zhipu', name:'ZhiPu', type:'openai', apiKey:'', apiHost:'https://open.bigmodel.cn/api/paas/v4/', anthropicApiHost:'https://open.bigmodel.cn/api/anthropic', models:SYSTEM_MODELS.zhipu, isSystem:true, enabled:false },
  moonshot: { id:'moonshot', name:'Moonshot', type:'openai', apiKey:'', apiHost:'https://api.moonshot.cn', anthropicApiHost:'https://api.moonshot.cn/anthropic', models:SYSTEM_MODELS.moonshot, isSystem:true, enabled:false },
  groq: { id:'groq', name:'Groq', type:'openai', apiKey:'', apiHost:'https://api.groq.com/openai', models:SYSTEM_MODELS.groq, isSystem:true, enabled:false },
  ollama: { id:'ollama', name:'Ollama', type:'ollama', apiKey:'', apiHost:'http://localhost:11434', anthropicApiHost:'http://localhost:11434', models:SYSTEM_MODELS.ollama, isSystem:true, enabled:false },
  'new-api': { id:'new-api', name:'New API', type:'new-api', apiKey:'', apiHost:'http://localhost:3000', anthropicApiHost:'http://localhost:3000', models:SYSTEM_MODELS['new-api'], isSystem:true, enabled:false },
  github: { id:'github', name:'Github Models', type:'openai', apiKey:'', apiHost:'https://models.github.ai/inference', models:SYSTEM_MODELS.github, isSystem:true, enabled:false },
} as const

export const SYSTEM_PROVIDERS: SystemProvider[] = Object.values(SYSTEM_PROVIDERS_CONFIG)

export const PROVIDER_LOGO_MAP: AtLeast<SystemProviderId, string> = {
  blackhole: BlackholeProviderLogo,
  openai: OpenAiProviderLogo,
  anthropic: AnthropicProviderLogo,
  gemini: GoogleProviderLogo,
  deepseek: DeepSeekProviderLogo,
  silicon: SiliconFlowProviderLogo,
  zhipu: ZhipuProviderLogo,
  moonshot: MoonshotProviderLogo,
  groq: GroqProviderLogo,
  ollama: OllamaProviderLogo,
  'new-api': NewAPIProviderLogo,
  github: GithubProviderLogo,
} as const

export function getProviderLogo(providerId: string) {
  return PROVIDER_LOGO_MAP[providerId as keyof typeof PROVIDER_LOGO_MAP]
}

export const NOT_SUPPORTED_RERANK_PROVIDERS = ['ollama', 'lmstudio'] as const satisfies SystemProviderId[]
export const ONLY_SUPPORTED_DIMENSION_PROVIDERS = ['ollama'] as const satisfies SystemProviderId[]

type ProviderUrls = { api:{url:string}; websites?:{official:string;apiKey?:string;docs:string;models?:string} }

export const PROVIDER_URLS: Record<SystemProviderId, ProviderUrls> = {
  blackhole: { api:{url:'http://8.137.146.148:9000'}, websites:{official:'http://8.137.146.148:9000', docs:'http://8.137.146.148:9000'} },
  openai: { api:{url:'https://api.openai.com'}, websites:{official:'https://openai.com/', apiKey:'https://platform.openai.com/api-keys', docs:'https://platform.openai.com/docs', models:'https://platform.openai.com/docs/models'} },
  deepseek: { api:{url:'https://api.deepseek.com'}, websites:{official:'https://deepseek.com/', apiKey:'https://platform.deepseek.com/api_keys', docs:'https://platform.deepseek.com/api-docs/', models:'https://platform.deepseek.com/api-docs/'} },
  silicon: { api:{url:'https://api.siliconflow.cn'}, websites:{official:'https://www.siliconflow.cn', apiKey:'https://cloud.siliconflow.cn/i/d1nTBKXU', docs:'https://docs.siliconflow.cn/', models:'https://cloud.siliconflow.cn/models'} },
  zhipu: { api:{url:'https://open.bigmodel.cn/api/paas/v4/'}, websites:{official:'https://open.bigmodel.cn/', apiKey:'https://open.bigmodel.cn/usercenter/apikeys', docs:'https://docs.bigmodel.cn/', models:'https://open.bigmodel.cn/modelcenter/square'} },
  moonshot: { api:{url:'https://api.moonshot.cn'}, websites:{official:'https://www.moonshot.cn/', apiKey:'https://platform.moonshot.cn/console/api-keys', docs:'https://platform.moonshot.cn/docs/', models:'https://platform.moonshot.cn/docs/intro'} },
  groq: { api:{url:'https://api.groq.com/openai'}, websites:{official:'https://groq.com/', apiKey:'https://console.groq.com/keys', docs:'https://console.groq.com/docs/quickstart', models:'https://console.groq.com/docs/models'} },
  ollama: { api:{url:'http://localhost:11434'}, websites:{official:'https://ollama.com/', docs:'https://github.com/ollama/ollama/tree/main/docs', models:'https://ollama.com/library'} },
  anthropic: { api:{url:'https://api.anthropic.com'}, websites:{official:'https://anthropic.com/', apiKey:'https://console.anthropic.com/settings/keys', docs:'https://docs.anthropic.com/en/docs', models:'https://docs.anthropic.com/en/docs/about-claude/models'} },
  gemini: { api:{url:'https://generativelanguage.googleapis.com'}, websites:{official:'https://gemini.google.com/', apiKey:'https://aistudio.google.com/app/apikey', docs:'https://ai.google.dev/gemini-api/docs', models:'https://ai.google.dev/gemini-api/docs/models/gemini'} },
  github: { api:{url:'https://models.github.ai/inference/'}, websites:{official:'https://github.com/marketplace/models', apiKey:'https://github.com/settings/tokens', docs:'https://docs.github.com/en/github-models', models:'https://github.com/marketplace/models'} },
  'new-api': { api:{url:'http://localhost:3000'}, websites:{official:'https://docs.newapi.pro/', docs:'https://docs.newapi.pro'} },
} as const
