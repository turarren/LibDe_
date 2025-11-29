import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface LibraryData {
  id: string;
  title: string;
  author: string;
  isbn: string;
  encryptedPages: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface LibraryStats {
  totalBooks: number;
  verifiedBooks: number;
  avgPages: number;
  recentAdditions: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<LibraryData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingBook, setAddingBook] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newBookData, setNewBookData] = useState({ title: "", author: "", isbn: "", pages: "" });
  const [selectedBook, setSelectedBook] = useState<LibraryData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [stats, setStats] = useState<LibraryStats>({ totalBooks: 0, verifiedBooks: 0, avgPages: 0, recentAdditions: 0 });
  const [contractAddress, setContractAddress] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      
      try {
        console.log('Initializing FHEVM for privacy library...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadBooks();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load library data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadBooks = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const booksList: LibraryData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          booksList.push({
            id: businessId,
            title: businessData.name,
            author: "Anonymous Author",
            isbn: `ISBN-${businessId.substring(0, 8)}`,
            encryptedPages: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading book data:', e);
        }
      }
      
      setBooks(booksList);
      calculateStats(booksList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load books" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (booksList: LibraryData[]) => {
    const totalBooks = booksList.length;
    const verifiedBooks = booksList.filter(b => b.isVerified).length;
    const avgPages = booksList.length > 0 
      ? booksList.reduce((sum, b) => sum + b.publicValue1, 0) / booksList.length 
      : 0;
    const recentAdditions = booksList.filter(b => 
      Date.now()/1000 - b.timestamp < 60 * 60 * 24 * 7
    ).length;

    setStats({ totalBooks, verifiedBooks, avgPages, recentAdditions });
  };

  const addBook = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingBook(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE加密添加图书..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const pagesValue = parseInt(newBookData.pages) || 0;
      const businessId = `book-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, pagesValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newBookData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        pagesValue,
        0,
        `作者: ${newBookData.author}, ISBN: ${newBookData.isbn}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `添加图书: ${newBookData.title}`]);
      setTransactionStatus({ visible: true, status: "success", message: "图书添加成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadBooks();
      setShowAddModal(false);
      setNewBookData({ title: "", author: "", isbn: "", pages: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消了交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingBook(false); 
    }
  };

  const checkAvailability = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "系统可用性检查成功!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "可用性检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptBookData = async (bookId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(bookId);
      if (businessData.isVerified) {
        setTransactionStatus({ visible: true, status: "success", message: "数据已链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(bookId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(bookId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadBooks();
      setUserHistory(prev => [...prev, `解密图书数据: ${bookId}`]);
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "数据已链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadBooks();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "解密失败: " + (e.message || "未知错误") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const filteredBooks = books.filter(book => 
    book.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    book.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
    book.isbn.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🌿 隐私图书馆</h1>
            <p>FHE加密保护您的阅读自由</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">📚</div>
            <h2>连接钱包进入隐私图书馆</h2>
            <p>基于Zama FHE的全同态加密技术，保护您的借阅隐私</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>连接您的钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始加密借阅之旅</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p>状态: {status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载隐私图书馆...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>🌿 LibDe_Zama</h1>
          <p>全同态加密隐私图书馆</p>
        </div>
        
        <div className="header-controls">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="搜索图书标题、作者或ISBN..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="search-icon">🔍</span>
          </div>
          
          <div className="header-buttons">
            <button onClick={checkAvailability} className="wood-btn">
              检查系统
            </button>
            <button onClick={() => setShowAddModal(true)} className="wood-btn primary">
              添加图书
            </button>
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="stats-section">
          <div className="stats-grid">
            <div className="stat-card wood-card">
              <h3>馆藏总数</h3>
              <div className="stat-value">{stats.totalBooks}</div>
              <div className="stat-trend">+{stats.recentAdditions} 本周新增</div>
            </div>
            
            <div className="stat-card wood-card">
              <h3>已验证数据</h3>
              <div className="stat-value">{stats.verifiedBooks}/{stats.totalBooks}</div>
              <div className="stat-trend">FHE加密验证</div>
            </div>
            
            <div className="stat-card wood-card">
              <h3>平均页数</h3>
              <div className="stat-value">{stats.avgPages.toFixed(0)}</div>
              <div className="stat-trend">页/本</div>
            </div>
          </div>
        </section>

        <section className="books-section">
          <div className="section-header">
            <h2>📖 馆藏图书</h2>
            <div className="section-actions">
              <button onClick={loadBooks} className="wood-btn" disabled={isRefreshing}>
                {isRefreshing ? "刷新中..." : "刷新列表"}
              </button>
            </div>
          </div>

          <div className="books-grid">
            {filteredBooks.length === 0 ? (
              <div className="empty-state wood-card">
                <div className="empty-icon">📚</div>
                <p>暂无图书数据</p>
                <button onClick={() => setShowAddModal(true)} className="wood-btn primary">
                  添加第一本图书
                </button>
              </div>
            ) : (
              filteredBooks.map((book, index) => (
                <div key={index} className="book-card wood-card">
                  <div className="book-header">
                    <h3>{book.title}</h3>
                    <span className={`status-badge ${book.isVerified ? 'verified' : 'encrypted'}`}>
                      {book.isVerified ? '✅ 已验证' : '🔒 加密中'}
                    </span>
                  </div>
                  
                  <div className="book-meta">
                    <span>作者: {book.author}</span>
                    <span>ISBN: {book.isbn}</span>
                  </div>
                  
                  <div className="book-info">
                    <div className="info-item">
                      <label>页数:</label>
                      <span>
                        {book.isVerified ? 
                          `${book.decryptedValue}页 (已解密)` : 
                          "🔒 FHE加密"
                        }
                      </span>
                    </div>
                    
                    <div className="info-item">
                      <label>添加时间:</label>
                      <span>{new Date(book.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="book-actions">
                    <button 
                      onClick={() => decryptBookData(book.id)}
                      className={`wood-btn small ${book.isVerified ? 'verified' : ''}`}
                    >
                      {book.isVerified ? '✅ 已验证' : '🔓 验证解密'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="history-section">
          <div className="section-header">
            <h2>📋 操作记录</h2>
          </div>
          <div className="history-list wood-card">
            {userHistory.length === 0 ? (
              <p className="no-history">暂无操作记录</p>
            ) : (
              userHistory.slice(-5).map((record, index) => (
                <div key={index} className="history-item">
                  <span className="time">{new Date().toLocaleTimeString()}</span>
                  <span className="action">{record}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showAddModal && (
        <AddBookModal 
          onSubmit={addBook}
          onClose={() => setShowAddModal(false)}
          adding={addingBook}
          bookData={newBookData}
          setBookData={setNewBookData}
          isEncrypting={isEncrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="notification-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const AddBookModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  adding: boolean;
  bookData: any;
  setBookData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, adding, bookData, setBookData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'pages') {
      const intValue = value.replace(/[^\d]/g, '');
      setBookData({ ...bookData, [name]: intValue });
    } else {
      setBookData({ ...bookData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content wood-card">
        <div className="modal-header">
          <h2>添加新图书</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 隐私保护</strong>
            <p>图书页数将使用Zama FHE进行加密，保护读者隐私</p>
          </div>
          
          <div className="form-group">
            <label>图书标题 *</label>
            <input 
              type="text" 
              name="title" 
              value={bookData.title} 
              onChange={handleChange} 
              placeholder="输入图书标题..." 
            />
          </div>
          
          <div className="form-group">
            <label>作者 *</label>
            <input 
              type="text" 
              name="author" 
              value={bookData.author} 
              onChange={handleChange} 
              placeholder="输入作者姓名..." 
            />
          </div>
          
          <div className="form-group">
            <label>ISBN *</label>
            <input 
              type="text" 
              name="isbn" 
              value={bookData.isbn} 
              onChange={handleChange} 
              placeholder="输入ISBN号..." 
            />
          </div>
          
          <div className="form-group">
            <label>页数 (整数) *</label>
            <input 
              type="number" 
              name="pages" 
              value={bookData.pages} 
              onChange={handleChange} 
              placeholder="输入页数..." 
              min="1"
            />
            <div className="input-hint">FHE加密整数数据</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="wood-btn">取消</button>
          <button 
            onClick={onSubmit}
            disabled={adding || isEncrypting || !bookData.title || !bookData.author || !bookData.isbn || !bookData.pages}
            className="wood-btn primary"
          >
            {adding || isEncrypting ? "加密并添加中..." : "添加图书"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;