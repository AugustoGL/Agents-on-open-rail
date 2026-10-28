// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Seña Ticket
/// @notice La reserva de un turno como NFT. El agente de Seña se lo manda a la billetera que pagó la seña.
/// @dev ERC-721 INTRANSFERIBLE (ERC-5192): el ticket es de quien pagó, así que la devolución nunca es ambigua.
///      Solo el agente puede emitirlo (`mint`), actualizar su estado (`setURI`: confirmada, jugada) y quemarlo
///      (`burn`: cancelación). El id sale del código de la reserva, así que emitir dos veces la misma reserva falla
///      (`YaExiste`) y el agente puede reintentar sin riesgo de duplicar. El contenido (nombre, imagen, atributos) viaja
///      en `tokenURI` como un `data:` URI: la reserva se ve en la billetera sin depender de ningún servidor.
contract SenaTicket {
    string public constant name = unicode"Seña Ticket";
    string public constant symbol = "SENA";

    address public owner;
    address public agent;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => string) private _uris;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Locked(uint256 tokenId); // ERC-5192
    event Unlocked(uint256 tokenId); // ERC-5192 (no se usa: nunca se desbloquea)
    event MetadataUpdate(uint256 _tokenId); // ERC-4906: las billeteras y mercados refrescan la imagen
    event AgenteCambiado(address indexed anterior, address indexed nuevo);

    error SoloAgente();
    error SoloDuenio();
    error YaExiste();
    error NoExiste();
    error Intransferible();
    error DireccionInvalida();

    constructor(address agent_) {
        if (agent_ == address(0)) revert DireccionInvalida();
        owner = msg.sender;
        agent = agent_;
        emit AgenteCambiado(address(0), agent_);
    }

    modifier soloAgente() {
        if (msg.sender != agent) revert SoloAgente();
        _;
    }

    /// @notice El dueño puede cambiar la billetera del agente (por ejemplo, si rota su clave).
    function setAgent(address nuevo) external {
        if (msg.sender != owner) revert SoloDuenio();
        if (nuevo == address(0)) revert DireccionInvalida();
        emit AgenteCambiado(agent, nuevo);
        agent = nuevo;
    }

    // --- Lo que hace el agente -------------------------------------------------------------------------------

    function mint(address to, uint256 tokenId, string calldata uri) external soloAgente {
        if (to == address(0)) revert DireccionInvalida();
        if (_owners[tokenId] != address(0)) revert YaExiste();
        _owners[tokenId] = to;
        unchecked { _balances[to] += 1; }
        _uris[tokenId] = uri;
        emit Transfer(address(0), to, tokenId);
        emit Locked(tokenId);
    }

    function setURI(uint256 tokenId, string calldata uri) external soloAgente {
        if (_owners[tokenId] == address(0)) revert NoExiste();
        _uris[tokenId] = uri;
        emit MetadataUpdate(tokenId);
    }

    function burn(uint256 tokenId) external soloAgente {
        address holder = _owners[tokenId];
        if (holder == address(0)) revert NoExiste();
        delete _owners[tokenId];
        delete _uris[tokenId];
        unchecked { _balances[holder] -= 1; }
        emit Transfer(holder, address(0), tokenId);
    }

    // --- Lectura (ERC-721) ----------------------------------------------------------------------------------------

    function exists(uint256 tokenId) external view returns (bool) {
        return _owners[tokenId] != address(0);
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _owners[tokenId];
        if (holder == address(0)) revert NoExiste();
    }

    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert DireccionInvalida();
        return _balances[holder];
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert NoExiste();
        return _uris[tokenId];
    }

    /// @notice ERC-5192: siempre bloqueado (intransferible).
    function locked(uint256 tokenId) external view returns (bool) {
        if (_owners[tokenId] == address(0)) revert NoExiste();
        return true;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        if (_owners[tokenId] == address(0)) revert NoExiste();
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    // --- Nada de esto se puede: el ticket no se transfiere ---------------------------------------------------------

    function approve(address, uint256) external pure { revert Intransferible(); }
    function setApprovalForAll(address, bool) external pure { revert Intransferible(); }
    function transferFrom(address, address, uint256) external pure { revert Intransferible(); }
    function safeTransferFrom(address, address, uint256) external pure { revert Intransferible(); }
    function safeTransferFrom(address, address, uint256, bytes calldata) external pure { revert Intransferible(); }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f // ERC-721 Metadata
            || interfaceId == 0xb45a3c0e // ERC-5192 (intransferible)
            || interfaceId == 0x49064906; // ERC-4906
    }
}
