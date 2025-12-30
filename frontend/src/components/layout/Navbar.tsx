import { useState, useRef, useEffect, useMemo, memo } from 'react'
import type { FC, RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../styles/Navbar.scss'
import SINRViewer from '../viewers/SINRViewer'
import CFRViewer from '../viewers/CFRViewer'
import DelayDopplerViewer from '../viewers/DelayDopplerViewer'
import TimeFrequencyViewer from '../viewers/TimeFrequencyViewer'
import ViewerModal from '../ui/ViewerModal'
import { ViewerProps } from '../../types/viewer'
import {
  SCENE_DISPLAY_NAMES,
  getSceneDisplayName,
} from '../../utils/sceneUtils'

interface NavbarProps {
  onMenuClick: (component: string) => void
  activeComponent: string
  currentScene: string
  allDevices?: Map<string, {
    lat: number
    lon: number
    alt: number
    accuracy: number
    deviceName: string
  }>
  myDeviceId?: string | null
  selectedDeviceId?: string | null
  onDeviceSelect?: (deviceId: string) => void
}

interface ModalConfig {
  id: string
  menuText: string
  titleConfig: {
    base: string
    loading: string
    hoverRefresh: string
  }
  isOpen: boolean
  openModal: () => void
  closeModal: () => void
  lastUpdate: string
  setLastUpdate: (time: string) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  refreshHandlerRef: RefObject<(() => void) | null>
  ViewerComponent: FC<ViewerProps>
}

// 裝置下拉選單 Props
interface DeviceDropdownProps {
  allDevices: Map<string, {
    lat: number
    lon: number
    alt: number
    accuracy: number
    deviceName: string
  }> | undefined
  myDeviceId: string | null
  selectedDeviceId: string | null
  isOpen: boolean
  onToggle: (e: React.MouseEvent) => void
  onDeviceSelect: (deviceId: string) => void
  isMobile: boolean
  setIsMenuOpen: (open: boolean) => void
}

// --- 💡 DeviceDropdown (穩定版) ---
const DeviceDropdown = memo(({
  allDevices,
  myDeviceId,
  selectedDeviceId,
  isOpen,
  onToggle,
  onDeviceSelect,
  isMobile,
  setIsMenuOpen
}: DeviceDropdownProps) => {
  
  // 取得當前選中裝置的顯示名稱
  const getSelectedDeviceName = () => {
    if (!allDevices || allDevices.size === 0) {
      return '裝置選擇器'
    }
    if (!selectedDeviceId) return '未選擇裝置'
    const device = allDevices.get(selectedDeviceId)
    
    // 如果找不到選中的裝置，但 ID 存在，就顯示 ID 前 8 碼
    // 這裡也加上短 ID 顯示，保持一致性
    const shortId = selectedDeviceId.substring(0, 4)
    if (!device) return `${selectedDeviceId.substring(0, 8)}...`
    
    return `${device.deviceName || 'Unknown'} (${shortId})`
  }

  // ✅ 計算裝置列表 (增強穩定性)
  const deviceList = useMemo(() => {
    // 防呆機制：確保 allDevices 是 Map
    if (!allDevices || !(allDevices instanceof Map)) return []
    
    return Array.from(allDevices.entries())
      .filter(([deviceId, device]) => {
        if (!device) return false

        // 1. 如果是「我自己」
        if (deviceId === myDeviceId) {
          const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
          // 邏輯：如果是筆電端 (Host)，通常不需要看自己的孿生面板，所以隱藏
          // 如果是手機端 (Client)，自己也是一個 Sensor，所以顯示
          return isMobileDevice
        }
        
        // 2. 其他裝置：必須有有效的 GPS 座標才顯示
        // 這樣可以過濾掉剛連線但還沒定位的空裝置
        return (device.lat !== 0 && device.lon !== 0)
      })
      .map(([deviceId, device]) => {
        const isMyDevice = deviceId === myDeviceId
        const isSelected = deviceId === selectedDeviceId
        
        // 🔥 修改這裡：顯示名稱 + ID 後 4 碼 (方便除錯)
        // 例如：iPhone (a1b2)
        const shortId = deviceId.split('-').pop()?.substring(0, 4) || '????'
        const displayName = `${device.deviceName || 'Unknown'} (${shortId})`
        
        return {
          deviceId,
          isMyDevice,
          isSelected,
          displayName,
        }
      })
      // ✅ 排序：讓已選中的裝置排在最上面，其他的按名稱排序
      .sort((a, b) => {
        if (a.isSelected) return -1
        if (b.isSelected) return 1
        return a.displayName.localeCompare(b.displayName)
      })
  }, [allDevices, myDeviceId, selectedDeviceId])

  const hasDevices = deviceList.length > 0

  return (
    <li
      className={`navbar-item navbar-dropdown-item device-selector ${
        isMobile && isOpen ? 'mobile-expanded' : ''
      }`}
      onClick={onToggle}
    >
      <span className="dropdown-trigger">
        <span className="device-icon">📱</span>
        <span className="device-name-display">{getSelectedDeviceName()}</span>
        <span className="dropdown-arrow-small">▼</span>
      </span>
      <div
        className={`device-dropdown ${isOpen ? 'show' : ''}`}
        onClick={(e) => e.stopPropagation()}
        style={{ 
          maxHeight: '300px', 
          overflowY: 'auto', // ✅ 支援多裝置時滾動
          zIndex: 2000       // ✅ 確保層級夠高
        }} 
      >
        {!hasDevices ? (
          <div className="device-dropdown-empty">
            <span className="empty-icon">⏳</span>
            <span className="empty-text">
              {allDevices && allDevices.size > 0 
                ? '沒有可選的有效裝置' 
                : '等待裝置連線...'}
            </span>
          </div>
        ) : (
          deviceList.map(({ deviceId, isMyDevice, isSelected, displayName }) => (
            <div
              key={deviceId}
              className={`device-dropdown-item ${isSelected ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                console.log('📱 選擇裝置:', displayName)
                onDeviceSelect(deviceId)
                if (isMobile) {
                  setIsMenuOpen(false)
                }
              }}
            >
              <span className="device-item-icon">
                {isMyDevice ? '🔵' : '📱'}
              </span>
              <span className="device-item-name">
                {displayName}
              </span>
            </div>
          ))
        )}
      </div>
    </li>
  )
})

DeviceDropdown.displayName = 'DeviceDropdown'

// --- Navbar 主組件 ---
const Navbar: FC<NavbarProps> = ({
  onMenuClick,
  activeComponent,
  currentScene,
  allDevices,
  myDeviceId,
  selectedDeviceId,
  onDeviceSelect,
}) => {
  const navigate = useNavigate()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isChartsDropdownOpen, setIsChartsDropdownOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isDeviceDropdownOpen, setIsDeviceDropdownOpen] = useState(false)

  // Modal States
  const [showSINRModal, setShowSINRModal] = useState(false)
  const [showCFRModal, setShowCFRModal] = useState(false)
  const [showDelayDopplerModal, setShowDelayDopplerModal] = useState(false)
  const [showTimeFrequencyModal, setShowTimeFrequencyModal] = useState(false)

  // Last Update Stamps
  const [sinrModalLastUpdate, setSinrModalLastUpdate] = useState<string>('')
  const [cfrModalLastUpdate, setCfrModalLastUpdate] = useState<string>('')
  const [delayDopplerModalLastUpdate, setDelayDopplerModalLastUpdate] = useState<string>('')
  const [timeFrequencyModalLastUpdate, setTimeFrequencyModalLastUpdate] = useState<string>('')

  // Refresh Handlers
  const sinrRefreshHandlerRef = useRef<(() => void) | null>(null)
  const cfrRefreshHandlerRef = useRef<(() => void) | null>(null)
  const delayDopplerRefreshHandlerRef = useRef<(() => void) | null>(null)
  const timeFrequencyRefreshHandlerRef = useRef<(() => void) | null>(null)

  // Loading States
  const [sinrIsLoadingForHeader, setSinrIsLoadingForHeader] = useState<boolean>(true)
  const [cfrIsLoadingForHeader, setCfrIsLoadingForHeader] = useState<boolean>(true)
  const [delayDopplerIsLoadingForHeader, setDelayDopplerIsLoadingForHeader] = useState<boolean>(true)
  const [timeFrequencyIsLoadingForHeader, setTimeFrequencyIsLoadingForHeader] = useState<boolean>(true)

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen)
  }

  const handleSceneChange = (sceneKey: string) => {
    const currentView = activeComponent === '3DRT' ? 'stereogram' : 'floor-plan'
    navigate(`/${sceneKey}/${currentView}`)
  }

  const handleFloorPlanClick = () => {
    navigate(`/${currentScene}/floor-plan`)
    onMenuClick('2DRT')
  }

  const handleStereogramClick = () => {
    navigate(`/${currentScene}/stereogram`)
    onMenuClick('3DRT')
  }

  const modalConfigs: ModalConfig[] = [
    {
      id: 'sinr',
      menuText: 'SINR MAP',
      titleConfig: {
        base: 'SINR Map',
        loading: '正在即時運算並生成 SINR Map...',
        hoverRefresh: '重新生成圖表',
      },
      isOpen: showSINRModal,
      openModal: () => setShowSINRModal(true),
      closeModal: () => setShowSINRModal(false),
      lastUpdate: sinrModalLastUpdate,
      setLastUpdate: setSinrModalLastUpdate,
      isLoading: sinrIsLoadingForHeader,
      setIsLoading: setSinrIsLoadingForHeader,
      refreshHandlerRef: sinrRefreshHandlerRef,
      ViewerComponent: SINRViewer,
    },
    {
      id: 'cfr',
      menuText: 'Constellation & CFR',
      titleConfig: {
        base: 'Constellation & CFR Magnitude',
        loading: '正在即時運算並生成 Constellation & CFR...',
        hoverRefresh: '重新生成圖表',
      },
      isOpen: showCFRModal,
      openModal: () => setShowCFRModal(true),
      closeModal: () => setShowCFRModal(false),
      lastUpdate: cfrModalLastUpdate,
      setLastUpdate: setCfrModalLastUpdate,
      isLoading: cfrIsLoadingForHeader,
      setIsLoading: setCfrIsLoadingForHeader,
      refreshHandlerRef: cfrRefreshHandlerRef,
      ViewerComponent: CFRViewer,
    },
    {
      id: 'delayDoppler',
      menuText: 'Delay–Doppler',
      titleConfig: {
        base: 'Delay-Doppler Plots',
        loading: '正在即時運算並生成 Delay-Doppler...',
        hoverRefresh: '重新生成圖表',
      },
      isOpen: showDelayDopplerModal,
      openModal: () => setShowDelayDopplerModal(true),
      closeModal: () => setShowDelayDopplerModal(false),
      lastUpdate: delayDopplerModalLastUpdate,
      setLastUpdate: setDelayDopplerModalLastUpdate,
      isLoading: delayDopplerIsLoadingForHeader,
      setIsLoading: setDelayDopplerIsLoadingForHeader,
      refreshHandlerRef: delayDopplerRefreshHandlerRef,
      ViewerComponent: DelayDopplerViewer,
    },
    {
      id: 'timeFrequency',
      menuText: 'Time-Frequency',
      titleConfig: {
        base: 'Time-Frequency Plots',
        loading: '正在即時運算並生成 Time-Frequency...',
        hoverRefresh: '重新生成圖表',
      },
      isOpen: showTimeFrequencyModal,
      openModal: () => setShowTimeFrequencyModal(true),
      closeModal: () => setShowTimeFrequencyModal(false),
      lastUpdate: timeFrequencyModalLastUpdate,
      setLastUpdate: setTimeFrequencyModalLastUpdate,
      isLoading: timeFrequencyIsLoadingForHeader,
      setIsLoading: setTimeFrequencyIsLoadingForHeader,
      refreshHandlerRef: timeFrequencyRefreshHandlerRef,
      ViewerComponent: TimeFrequencyViewer,
    },
  ]

  const [dropdownPosition, setDropdownPosition] = useState<{ left: number }>({
    left: 0,
  })
  const logoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const updatePosition = () => {
      if (logoRef.current) {
        const rect = logoRef.current.getBoundingClientRect()
        setDropdownPosition({
          left: rect.left + rect.width / 2,
        })
      }
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [])

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const handleChartsDropdownToggle = () => {
    if (isMobile) {
      setIsChartsDropdownOpen(!isChartsDropdownOpen)
    }
  }

  const handleChartsMouseEnter = () => {
    if (!isMobile) setIsChartsDropdownOpen(true)
  }

  const handleChartsMouseLeave = () => {
    if (!isMobile) setIsChartsDropdownOpen(false)
  }

  const handleDeviceDropdownToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDeviceDropdownOpen(!isDeviceDropdownOpen)
  }

  const hasActiveChart = modalConfigs.some((config) => config.isOpen)
  const isLaptop = !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  // 點擊外部關閉裝置選單
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const isInsideDeviceSelector = target.closest('.device-selector')
      
      if (!isInsideDeviceSelector && isDeviceDropdownOpen) {
        setIsDeviceDropdownOpen(false)
      }
    }

    if (isDeviceDropdownOpen) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [isDeviceDropdownOpen])

  return (
    <>
      <nav className="navbar">
        <div className="navbar-container">
          <div
            className="navbar-dropdown-wrapper"
            onMouseEnter={() => setIsDropdownOpen(true)}
            onMouseLeave={() => setIsDropdownOpen(false)}
          >
            <div
              className="navbar-logo"
              ref={logoRef}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              {getSceneDisplayName(currentScene)}
              <span className="dropdown-arrow">▼</span>
            </div>
            <div
              className={`scene-dropdown ${isDropdownOpen ? 'show' : ''}`}
              style={{ left: `${dropdownPosition.left}px` }}
            >
              {Object.entries(SCENE_DISPLAY_NAMES).map(([key, value]) => (
                <div
                  key={key}
                  className={`scene-option ${key === currentScene ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSceneChange(key)
                    setIsDropdownOpen(false)
                  }}
                >
                  {value}
                </div>
              ))}
            </div>
          </div>

          <div className="navbar-menu-toggle" onClick={toggleMenu}>
            <span className={`menu-icon ${isMenuOpen ? 'open' : ''}`}></span>
          </div>

          <ul className={`navbar-menu ${isMenuOpen ? 'open' : ''}`}>
            {/* 裝置選擇器：電腦版才顯示 */}
            {isLaptop && (
              <DeviceDropdown
                allDevices={allDevices}
                myDeviceId={myDeviceId || null}
                selectedDeviceId={selectedDeviceId || null}
                isOpen={isDeviceDropdownOpen}
                onToggle={handleDeviceDropdownToggle}
                onDeviceSelect={(deviceId) => {
                  onDeviceSelect?.(deviceId)
                  setIsDeviceDropdownOpen(false)
                }}
                isMobile={isMobile}
                setIsMenuOpen={setIsMenuOpen}
              />
            )}

            {/* 圖表 Dropdown */}
            <li
              className={`navbar-item navbar-dropdown-item ${hasActiveChart ? 'active' : ''} ${
                isMobile && isChartsDropdownOpen ? 'mobile-expanded' : ''
              }`}
              onMouseEnter={handleChartsMouseEnter}
              onMouseLeave={handleChartsMouseLeave}
            >
              <span
                className="dropdown-trigger"
                onClick={handleChartsDropdownToggle}
              >
                圖表
                <span className="dropdown-arrow-small">▼</span>
              </span>
              <div className={`charts-dropdown ${isChartsDropdownOpen ? 'show' : ''}`}>
                {modalConfigs.map((config) => (
                  <div
                    key={config.id}
                    className={`charts-dropdown-item ${config.isOpen ? 'active' : ''}`}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      config.openModal()
                      setIsChartsDropdownOpen(false)
                      if (isMobile) setIsMenuOpen(false)
                    }}
                  >
                    {config.menuText}
                  </div>
                ))}
              </div>
            </li>

            <li
              className={`navbar-item ${activeComponent === '2DRT' ? 'active' : ''}`}
              onClick={handleFloorPlanClick}
            >
              平面圖
            </li>
            <li
              className={`navbar-item ${activeComponent === '3DRT' ? 'active' : ''}`}
              onClick={handleStereogramClick}
            >
              立體圖
            </li>
          </ul>
        </div>
      </nav>

      {modalConfigs.map((config) => (
        <ViewerModal
          key={config.id}
          isOpen={config.isOpen}
          onClose={config.closeModal}
          modalTitleConfig={config.titleConfig}
          lastUpdateTimestamp={config.lastUpdate}
          isLoading={config.isLoading}
          onRefresh={config.refreshHandlerRef.current}
          viewerComponent={
            <config.ViewerComponent
              onReportLastUpdateToNavbar={config.setLastUpdate}
              reportRefreshHandlerToNavbar={(handler: () => void) => {
                config.refreshHandlerRef.current = handler
              }}
              reportIsLoadingToNavbar={config.setIsLoading}
              currentScene={currentScene}
            />
          }
        />
      ))}
    </>
  )
}

export default Navbar