import { describe, expect, it } from 'vitest'
import { similarTitle } from './similar'

describe('相似标题（只用来问，不自动合并）', () => {
  it('简称包含在完整标题里', () => {
    expect(similarTitle('Living Media Interfaces', 'Living Media Interfaces: A Multi-Perspective Analysis of Biological Materials')).toBe(true)
  })
  it('大部分用词相同', () => {
    expect(similarTitle('guidelines human-AI interaction', 'Guidelines for Human-AI Interaction')).toBe(true)
    expect(similarTitle('mold as material paper', 'Mold as a Design Material')).toBe(true)
  })
  it('中文标题按相邻两个字比较', () => {
    expect(similarTitle('霉菌作为设计材料', '霉菌作为设计材料的可能性')).toBe(true)
    expect(similarTitle('霉菌设计材料研究', '把霉菌作为设计材料：一项研究')).toBe(true)
  })
  it('只有一个词相同不算', () => {
    expect(similarTitle('Living Media Interfaces', 'Social Media Use Among Teens')).toBe(false)
    expect(similarTitle('Interaction', 'Guidelines for Human-AI Interaction')).toBe(false)
  })
  it('完全不同', () => {
    expect(similarTitle('共在的理论框架', '霉菌作为设计材料')).toBe(false)
    expect(similarTitle('', 'anything at all')).toBe(false)
  })
})
